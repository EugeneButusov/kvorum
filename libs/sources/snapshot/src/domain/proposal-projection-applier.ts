import type { Kysely } from 'kysely';
import type { Logger } from '@libs/chain';
import {
  ActorRepository,
  ArchiveDerivationRepository,
  ProposalRepository,
  type NewProposalChoice,
  type OffchainArchiveRow,
  type PgDatabase,
} from '@libs/db';
import type { OffchainProjectionDeriver } from '@sources/core';
import { snapshotMetrics } from '../metrics';
import { projectSnapshotProposal, type SnapshotProposalDerive } from './proposal-projector';
import type { SnapshotProposalPayload } from './types';
import { SnapshotArchivePayloadRepository } from '../persistence/archive-payload-repository';
import { SnapshotProposalRepository } from '../persistence/snapshot-proposal-repository';

const SOURCE_TYPE = 'snapshot';

/** The repositories an apply runs against — all bound to the same transaction in production. */
export interface SnapshotProjectionRepos {
  proposals: ProposalRepository;
  actors: ActorRepository;
  snapshotProposals: SnapshotProposalRepository;
  archive: ArchiveDerivationRepository;
}

export type SnapshotTransactionRunner = (
  fn: (repos: SnapshotProjectionRepos) => Promise<void>,
) => Promise<void>;

export interface SnapshotProposalProjectionApplierDeps {
  pgDb: Kysely<PgDatabase>;
  payloads: SnapshotArchivePayloadRepository;
  /** Non-transactional repo for the failure path (attempt increment outside the tx). */
  archive: ArchiveDerivationRepository;
  logger: Logger;
  /** Override the per-row transaction runner (tests inject mock repos). */
  withTransaction?: SnapshotTransactionRunner;
}

function defaultTransactionRunner(pgDb: Kysely<PgDatabase>): SnapshotTransactionRunner {
  return (fn) =>
    pgDb.transaction().execute((tx) =>
      fn({
        proposals: new ProposalRepository(tx),
        actors: new ActorRepository(tx),
        snapshotProposals: new SnapshotProposalRepository(tx),
        archive: new ArchiveDerivationRepository(tx),
      }),
    );
}

/** Derives archived Snapshot proposals into `proposal` + `snapshot_proposal_metadata` +
 *  `proposal_choice`. Off-chain mutable-latest: an edit re-derives the same row (the consumer reset
 *  `derived_at`), updating fields + reindexing choices + re-setting state via the guard-bypass
 *  `setStateFromDerivation` (state is a pure function of the latest payload). */
export class SnapshotProposalProjectionApplier implements OffchainProjectionDeriver {
  readonly kind = 'offchain-projection' as const;
  readonly sourceTypes = ['snapshot'] as const;
  readonly eventTypes = ['SnapshotProposalCreated'] as const;

  private readonly withTransaction: SnapshotTransactionRunner;

  constructor(private readonly deps: SnapshotProposalProjectionApplierDeps) {
    this.withTransaction = deps.withTransaction ?? defaultTransactionRunner(deps.pgDb);
  }

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

      let payload: SnapshotProposalPayload;
      try {
        payload = JSON.parse(payloadJson) as SnapshotProposalPayload;
      } catch (err) {
        await this.fail(row, 'decode_error', err);
        continue;
      }

      try {
        const projection = projectSnapshotProposal(payload);
        await this.withTransaction((repos) => this.applyProjection(row, projection, repos));
      } catch (err) {
        await this.fail(row, 'projection_apply_error', err);
      }
    }
  }

  private async applyProjection(
    row: OffchainArchiveRow,
    projection: ReturnType<typeof projectSnapshotProposal>,
    repos: SnapshotProjectionRepos,
  ): Promise<void> {
    if (projection.kind === 'flagged') {
      await repos.archive.markDerived(row.id);
      this.record('skipped_flagged');
      return;
    }

    const daoId = await repos.proposals.findDaoIdForSource(row.dao_source_id);
    if (daoId === undefined) throw new Error(`unknown dao_source ${row.dao_source_id}`);

    if (projection.kind === 'deleted') {
      const existing = await repos.proposals.findBySource({
        daoId,
        sourceType: SOURCE_TYPE,
        sourceId: projection.sourceId,
      });
      if (existing !== undefined) {
        await repos.proposals.setStateFromDerivation({
          proposalId: existing.id,
          state: 'canceled',
          stateUpdatedAt: new Date(),
        });
      }
      await repos.archive.markDerived(row.id);
      this.record('deleted');
      return;
    }

    await this.applyDerive(projection, daoId, repos);
    await repos.archive.markDerived(row.id);
  }

  private async applyDerive(
    projection: SnapshotProposalDerive,
    daoId: string,
    repos: SnapshotProjectionRepos,
  ): Promise<void> {
    if (projection.proposerAddress == null) {
      throw new Error(`snapshot proposal ${projection.sourceId} has no author`);
    }
    const proposer = await repos.actors.findOrCreateActorAddress(
      projection.proposerAddress,
      'proposer_event',
    );

    const insert = await repos.proposals.insertProposal({
      dao_id: daoId,
      source_type: SOURCE_TYPE,
      source_id: projection.sourceId,
      proposer_actor_id: proposer.id,
      title: projection.title,
      description: projection.description,
      description_hash: projection.descriptionHash,
      binding: false,
      voting_starts_at: projection.votingStartsAt,
      voting_ends_at: projection.votingEndsAt,
      voting_starts_block: null,
      voting_ends_block: null,
      state: projection.state,
      state_updated_at: projection.stateUpdatedAt,
      updated_at: new Date(),
    });

    let proposalId: string;
    if (insert.inserted) {
      proposalId = insert.proposalId!;
      await repos.proposals.ensureChoices(proposalId, choiceRows(projection.choices));
      this.record('derived');
    } else {
      // Edit: the proposal already exists (off-chain consumer reset derived_at on the content
      // change). Update mutable fields, reindex choices, and re-set state via the guard-bypass.
      const existing = await repos.proposals.findBySource({
        daoId,
        sourceType: SOURCE_TYPE,
        sourceId: projection.sourceId,
      });
      if (existing === undefined) throw new Error('proposal not found after insert conflict');
      proposalId = existing.id;
      await repos.proposals.updateDerivedFields({
        proposalId,
        title: projection.title,
        description: projection.description,
        descriptionHash: projection.descriptionHash,
        votingStartsAt: projection.votingStartsAt,
        votingEndsAt: projection.votingEndsAt,
      });
      await repos.proposals.reindexChoices(proposalId, choiceRows(projection.choices));
      await repos.proposals.setStateFromDerivation({
        proposalId,
        state: projection.state,
        stateUpdatedAt: projection.stateUpdatedAt,
      });
      this.record('updated');
    }

    await repos.snapshotProposals.upsertMetadata({
      proposal_id: proposalId,
      ...projection.metadata,
    });
  }

  private async fail(row: OffchainArchiveRow, reason: string, error: unknown): Promise<void> {
    await this.deps.archive.incrementAttemptCount(row.id);
    this.record('failed');
    this.deps.logger.error('snapshot_proposal_derivation_failed', {
      row_id: row.id,
      external_id: row.external_id,
      event_type: row.event_type,
      attempt: row.derivation_attempt_count + 1,
      reason,
      error: String(error),
    });
  }

  private record(outcome: string): void {
    snapshotMetrics.proposalsDerived.add(1, { outcome });
  }
}

function choiceRows(choices: readonly string[]): NewProposalChoice[] {
  return choices.map((value, choice_index) => ({ proposal_id: '', choice_index, value }));
}
