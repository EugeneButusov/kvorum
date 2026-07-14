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

type ProposalRow = Awaited<ReturnType<ProposalRepository['findBySource']>>;
type ProposalMetadata = Awaited<ReturnType<SnapshotProposalRepository['findMetadata']>>;

/** Per-`applyBatch` memoisation of the repository lookups that repeat across votes on the same
 *  proposal. Keyed so a value of `undefined` (dao/proposal not found) is still cached — distinguished
 *  from "not looked up yet" by `Map.has`. */
interface BatchLookupCache {
  daoId: Map<string, string | undefined>;
  proposal: Map<string, ProposalRow>;
  metadata: Map<string, ProposalMetadata>;
  excluded: Map<string, boolean>;
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

    // Per-batch memoisation: dao/proposal/metadata/excluded do not change within a batch (proposals
    // derive before their votes), and a batch is dominated by votes on a handful of proposals — so a
    // 150-vote batch on ~10 proposals goes from ~450 repository round-trips to ~20.
    const cache: BatchLookupCache = {
      daoId: new Map(),
      proposal: new Map(),
      metadata: new Map(),
      excluded: new Map(),
    };

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
        await this.apply(row, payload, cache);
      } catch (err) {
        await this.fail(row, 'projection_apply_error', err);
      }
    }
  }

  private async apply(
    row: OffchainArchiveRow,
    payload: SnapshotVotePayload,
    cache: BatchLookupCache,
  ): Promise<void> {
    const proposalSourceId = payload.proposal?.id;
    const voter = payload.voter;
    if (proposalSourceId == null || voter == null || payload.created == null) {
      throw new Error(`snapshot vote ${payload.id} missing proposal/voter/created`);
    }
    const voterAddress = voter.toLowerCase();
    if (voterAddress.length !== ADDRESS_LENGTH) {
      throw new Error(`snapshot vote ${payload.id} voter is not a 42-char address`);
    }

    const daoId = await this.daoIdFor(row.dao_source_id, cache);
    if (daoId === undefined) throw new Error(`unknown dao_source ${row.dao_source_id}`);

    const proposal = await this.proposalFor(daoId, proposalSourceId, cache);
    if (proposal === undefined) {
      // No `proposal` row for this vote's parent. Distinguish an intentionally-excluded proposal
      // (spam `flagged` or `deleted` — the proposal projector skips these, so a row never appears)
      // from one that simply hasn't been derived yet. The former must be skipped: otherwise the vote
      // throws `no_proposal` and retries forever, saturating the derivation queue (poison message).
      // The latter must keep retrying so an in-flight proposal's votes are never dropped.
      if (await this.parentProposalIsExcluded(proposalSourceId, cache)) {
        await this.deps.archive.markDerived(row.id);
        this.record('skipped_orphan_excluded');
        return;
      }
      throw new Error(`no_proposal ${proposalSourceId}`);
    }

    const metadata = await this.metadataFor(proposal.id, cache);
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

  private async daoIdFor(
    daoSourceId: string,
    cache: BatchLookupCache,
  ): Promise<string | undefined> {
    if (!cache.daoId.has(daoSourceId)) {
      cache.daoId.set(daoSourceId, await this.deps.proposals.findDaoIdForSource(daoSourceId));
    }
    return cache.daoId.get(daoSourceId);
  }

  private async proposalFor(
    daoId: string,
    proposalSourceId: string,
    cache: BatchLookupCache,
  ): Promise<ProposalRow> {
    const key = `${daoId} ${proposalSourceId}`;
    if (!cache.proposal.has(key)) {
      cache.proposal.set(
        key,
        await this.deps.proposals.findBySource({
          daoId,
          sourceType: SOURCE_TYPE,
          sourceId: proposalSourceId,
        }),
      );
    }
    return cache.proposal.get(key);
  }

  private async metadataFor(
    proposalId: string,
    cache: BatchLookupCache,
  ): Promise<ProposalMetadata> {
    if (!cache.metadata.has(proposalId)) {
      cache.metadata.set(proposalId, await this.deps.snapshotProposals.findMetadata(proposalId));
    }
    return cache.metadata.get(proposalId);
  }

  /** True when the vote's parent proposal is archived but flagged/deleted — the proposal projector
   *  intentionally creates no `proposal` row for these, so their votes have no home and must be
   *  skipped rather than retried. False when the proposal payload is absent or a normal proposal
   *  (not yet derived → the caller retries so the vote is never dropped). Memoised per batch because
   *  a flagged proposal is a poison magnet — every one of its votes would otherwise re-read the CH
   *  payload. */
  private async parentProposalIsExcluded(
    proposalSourceId: string,
    cache: BatchLookupCache,
  ): Promise<boolean> {
    const cached = cache.excluded.get(proposalSourceId);
    if (cached !== undefined) return cached;
    const payloadJson = await this.deps.payloads.fetchByExternalId(`prop:${proposalSourceId}`);
    const excluded = this.classifyExcluded(payloadJson);
    cache.excluded.set(proposalSourceId, excluded);
    return excluded;
  }

  private classifyExcluded(payloadJson: string | undefined): boolean {
    if (payloadJson === undefined) return false;
    try {
      const p = JSON.parse(payloadJson) as { flagged?: boolean; deleted?: boolean };
      return p.flagged === true || p.deleted === true;
    } catch {
      return false;
    }
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
