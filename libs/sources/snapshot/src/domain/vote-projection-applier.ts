import type { Logger } from '@libs/chain';
import type {
  ArchiveDerivationRepository,
  OffchainArchiveRow,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
} from '@libs/db';
import { buildVoteRows, isNewerVote, type OffchainProjectionDeriver } from '@sources/core';
import { snapshotMetrics } from '../metrics';
import type { SnapshotVotePayload } from './types';
import { decodeVoteChoice } from './vote-choice-decoder';
import { networkToChainId, roundVp } from './voting-power';
import type { SnapshotArchivePayloadRepository } from '../persistence/archive-payload-repository';
import type { SnapshotProposalRepository } from '../persistence/snapshot-proposal-repository';
import type { SnapshotVoteChoiceRepository } from '../persistence/snapshot-vote-choice-repository';

const SOURCE_TYPE = 'snapshot';
const ADDRESS_LENGTH = 42;

export interface SnapshotVoteProjectionApplierDeps {
  payloads: SnapshotArchivePayloadRepository;
  proposals: ProposalRepository;
  snapshotProposals: SnapshotProposalRepository;
  voteRead: VoteEventsProjectionReadRepository;
  voteWrite: VoteEventsProjectionWriter;
  voteChoice: SnapshotVoteChoiceRepository;
  archive: ArchiveDerivationRepository;
  logger: Logger;
}

/** Derives archived Snapshot votes into the core `vote_events_*` pipeline (primary_choice + rounded
 *  voting_power + supersession) and the `snapshot_vote_choice` protocol table (full breakdown). Votes
 *  derive continuously — a non-shielded vote's choice + vp are final at cast (snapshot block), so this
 *  honors "consume only at final" for what we store. Shielded/undecodable choices are skipped (KNOWN
 *  follow-up). Supersession reuses the shared `buildVoteRows`/`isNewerVote` with off-chain sentinels;
 *  same-second re-votes are unobservable + unorderable, resolved deterministically (ADR-072 amend). */
export class SnapshotVoteProjectionApplier implements OffchainProjectionDeriver {
  readonly kind = 'offchain-projection' as const;
  readonly sourceTypes = ['snapshot'] as const;
  readonly eventTypes = ['SnapshotVoteCast'] as const;

  constructor(private readonly deps: SnapshotVoteProjectionApplierDeps) {}

  async applyBatch(rows: readonly OffchainArchiveRow[]): Promise<void> {
    if (rows.length === 0) return;
    const payloads = await this.deps.payloads.fetchLatest(rows);
    const byExternalId = new Map(payloads.map((row) => [row.external_id, row.payload]));

    for (const row of rows) {
      const payloadJson = byExternalId.get(row.external_id);
      if (payloadJson === undefined) {
        await this.fail(row, 'payload_missing', new Error('archive payload missing'));
        continue;
      }
      let payload: SnapshotVotePayload;
      try {
        payload = JSON.parse(payloadJson) as SnapshotVotePayload;
      } catch (err) {
        await this.fail(row, 'decode_error', err);
        continue;
      }
      try {
        await this.apply(row, payload);
      } catch (err) {
        await this.fail(row, 'projection_apply_error', err);
      }
    }
  }

  private async apply(row: OffchainArchiveRow, payload: SnapshotVotePayload): Promise<void> {
    const proposalSourceId = payload.proposal?.id;
    const voter = payload.voter;
    if (proposalSourceId == null || voter == null || payload.created == null) {
      throw new Error(`snapshot vote ${payload.id} missing proposal/voter/created`);
    }
    const voterAddress = voter.toLowerCase();
    if (voterAddress.length !== ADDRESS_LENGTH) {
      throw new Error(`snapshot vote ${payload.id} voter is not a 42-char address`);
    }

    const daoId = await this.deps.proposals.findDaoIdForSource(row.dao_source_id);
    if (daoId === undefined) throw new Error(`unknown dao_source ${row.dao_source_id}`);

    const proposal = await this.deps.proposals.findBySource({
      daoId,
      sourceType: SOURCE_TYPE,
      sourceId: proposalSourceId,
    });
    if (proposal === undefined) throw new Error(`no_proposal ${proposalSourceId}`);

    const metadata = await this.deps.snapshotProposals.findMetadata(proposal.id);
    if (metadata === undefined) throw new Error(`no_metadata ${proposal.id}`);

    const decoded = decodeVoteChoice(metadata.voting_type, payload.choice, metadata.choice_count);
    if (decoded.kind === 'undecodable') {
      // Shielded/encrypted or malformed choice — skip but mark derived so it leaves the selection.
      await this.deps.archive.markDerived(row.id);
      this.record('skipped_shielded');
      return;
    }

    const castAt = new Date(payload.created * 1000);
    const votingChainId = networkToChainId(metadata.network);
    const votingPower = roundVp(payload.vp);

    const current = await this.deps.voteRead.findCurrentVote({
      daoId,
      proposalId: proposal.id,
      voterAddress,
    });

    // Re-deriving the already-current row: backfill a missing protocol row (CH writes aren't atomic
    // with the vote_events write), then skip — buildVoteRows would otherwise self-supersede to zero.
    if (current !== undefined && current.vote_id === row.id) {
      if (!(await this.deps.voteChoice.existsForVote(row.id))) {
        await this.deps.voteChoice.insert({
          voteId: row.id,
          choices: decoded.choices,
          vp: String(payload.vp ?? '0'),
          vpByStrategy: payload.vp_by_strategy,
        });
      }
      await this.deps.archive.markDerived(row.id);
      this.record('skipped_idempotent');
      return;
    }

    const incomingIsNewer = isNewerVote(castAt, '0', 0, current);
    const voteRows = buildVoteRows({
      row: { id: row.id, block_number: '0', log_index: 0, chain_id: votingChainId },
      daoId,
      proposalId: proposal.id,
      voterAddress,
      castAt,
      incoming: { primaryChoice: decoded.primaryChoice, votingPower },
      current,
      incomingIsNewer,
    });

    // Protocol row first so primary_choice never exists without its breakdown (S7).
    await this.deps.voteChoice.insert({
      voteId: row.id,
      choices: decoded.choices,
      vp: String(payload.vp ?? '0'),
      vpByStrategy: payload.vp_by_strategy,
    });
    await this.deps.voteWrite.insertBatch(voteRows);
    await this.deps.archive.markDerived(row.id);
    this.record(incomingIsNewer ? 'derived' : 'superseded');
  }

  private async fail(row: OffchainArchiveRow, reason: string, error: unknown): Promise<void> {
    await this.deps.archive.incrementAttemptCount(row.id);
    this.record('failed');
    this.deps.logger.error('snapshot_vote_derivation_failed', {
      row_id: row.id,
      external_id: row.external_id,
      attempt: row.derivation_attempt_count + 1,
      reason,
      error: String(error),
    });
  }

  private record(outcome: string): void {
    snapshotMetrics.votesDerived.add(1, { outcome });
  }
}
