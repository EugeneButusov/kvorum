import { sql, type Kysely } from 'kysely';
import type {
  NewProposal,
  NewProposalAction,
  NewProposalChoice,
  PgDatabase,
  Proposal,
  ProposalState,
} from './schema/pg';

export interface InsertProposalResult {
  inserted: boolean;
  proposalId?: string;
}

export interface ProposalActionInput {
  targetAddress: string;
  targetChainId: string;
  valueWei: string;
  functionSignature: string | null;
  calldata: string;
}

export interface AdvanceProposalStateInput {
  daoId: string;
  sourceType: string;
  sourceId: string;
  targetState: Extract<ProposalState, 'active' | 'queued' | 'executed' | 'canceled' | 'defeated'>;
  stateUpdatedAt: Date;
}

export interface PendingTimestampFillRow {
  id: string;
  chain_id: string;
  voting_starts_block: string | null;
  voting_starts_at: Date | null;
  voting_ends_block: string | null;
  voting_ends_at: Date | null;
}

export interface TimestampFillInput {
  id: string;
  voting_starts_at: Date | null;
  voting_ends_at: Date | null;
}

export interface ProposalSourceLookupInput {
  daoId: string;
  sourceType: string;
  sourceId: string;
}

// Non-binding source types that the M5-2 summarizer still summarizes (Snapshot signaling). Today
// Snapshot is the only non-binding source; a second one would be added here (see plan-m5-2.2).
const SIGNALING_SOURCE_TYPES = ['snapshot'] as const;

export class ProposalRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findDaoIdForSource(daoSourceId: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('dao_source')
      .select('dao_id')
      .where('id', '=', daoSourceId)
      .executeTakeFirst();

    return row?.dao_id;
  }

  async findBySource(input: ProposalSourceLookupInput): Promise<Proposal | undefined> {
    return this.db
      .selectFrom('proposal')
      .selectAll()
      .where('dao_id', '=', input.daoId)
      .where('source_type', '=', input.sourceType)
      .where('source_id', '=', input.sourceId)
      .executeTakeFirst();
  }

  async insertProposal(row: NewProposal): Promise<InsertProposalResult> {
    const inserted = await this.db
      .insertInto('proposal')
      .values(row)
      .onConflict((oc) => oc.constraint('proposal_dao_id_source_type_source_id_key').doNothing())
      .returning('id')
      .executeTakeFirst();

    if (inserted === undefined) return { inserted: false };
    return { inserted: true, proposalId: inserted.id };
  }

  async insertActions(
    proposalId: string,
    actions: readonly ProposalActionInput[],
    payloadIndex = 0,
  ): Promise<number> {
    if (actions.length === 0) return 0;

    const rows: NewProposalAction[] = actions.map((action, index) => ({
      proposal_id: proposalId,
      payload_index: payloadIndex,
      action_index: index,
      target_address: action.targetAddress.toLowerCase(),
      target_chain_id: action.targetChainId,
      value_wei: action.valueWei,
      function_signature: action.functionSignature,
      calldata: action.calldata,
    }));

    const result = await this.db
      .insertInto('proposal_action')
      .values(rows)
      .onConflict((oc) => oc.columns(['proposal_id', 'payload_index', 'action_index']).doNothing())
      .executeTakeFirst();

    return Number(result?.numInsertedOrUpdatedRows ?? 0n);
  }

  async ensureChoices(proposalId: string, choices: readonly NewProposalChoice[]): Promise<void> {
    if (choices.length === 0) return;

    await this.db
      .insertInto('proposal_choice')
      .values(choices.map((choice) => ({ ...choice, proposal_id: proposalId })))
      .onConflict((oc) => oc.columns(['proposal_id', 'choice_index']).doNothing())
      .execute();
  }

  async advanceState(input: AdvanceProposalStateInput): Promise<number> {
    const allowedFromByTarget: Record<
      AdvanceProposalStateInput['targetState'],
      readonly ProposalState[]
    > = {
      active: ['pending'],
      queued: ['pending', 'active'],
      executed: ['pending', 'queued', 'active'],
      canceled: ['pending', 'queued', 'active'],
      defeated: ['pending', 'active'],
    };
    const allowedCurrentStates = allowedFromByTarget[input.targetState];

    const query = this.db
      .updateTable('proposal')
      .where('dao_id', '=', input.daoId)
      .where('source_type', '=', input.sourceType)
      .where('source_id', '=', input.sourceId)
      .where('state', 'not in', ['executed', 'canceled', 'defeated'])
      .where('state', 'in', allowedCurrentStates);

    const result = await query
      .set({
        state: input.targetState,
        state_updated_at: input.stateUpdatedAt,
        updated_at: sql<Date>`now()`,
      })
      .executeTakeFirst();

    return Number(result?.numUpdatedRows ?? 0n);
  }

  /** Proposals whose state is in `states` and that transitioned at/after `since`. Drives the
   *  M5-1.4 AI trigger scan (index: idx_proposal_state_updated_at). Returns bare ids. */
  async findRecentlyTransitioned(
    states: readonly ProposalState[],
    since: Date,
  ): Promise<{ id: string }[]> {
    if (states.length === 0) return [];
    return this.db
      .selectFrom('proposal')
      .select('id')
      .where('state', 'in', states)
      .where('state_updated_at', '>=', since)
      .execute();
  }

  /**
   * Absolute state set for authoritative cross-source reclassification — bypasses the monotonic,
   * terminal-locked `advanceState` guard. Used by the Lido Dual Governance proposal deriver (AB3): a
   * DG-routed proposal's unified state is `f(dual_governance_proposal.status)`, so DG (authoritative
   * post-enactment) overrides the Aragon layer's premature `executed` (set on `ExecuteVote`) with
   * `queued`, then drives it forward. Replay-safe: the value derives from the authoritative ledger
   * status, not the current `proposal.state`, so re-deriving any event re-sets the same value. Do NOT
   * use for normal monotonic lifecycle advances — use `advanceState`.
   */
  async setStateFromDerivation(input: {
    proposalId: string;
    state: ProposalState;
    stateUpdatedAt: Date;
  }): Promise<void> {
    await this.db
      .updateTable('proposal')
      .set({
        state: input.state,
        state_updated_at: input.stateUpdatedAt,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', input.proposalId)
      .execute();
  }

  async updateTitleDescription(
    proposalId: string,
    title: string | null,
    description: string,
  ): Promise<void> {
    await this.db
      .updateTable('proposal')
      .set({
        title,
        description,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', proposalId)
      .execute();
  }

  /**
   * Update the mutable, derivation-owned content fields of an existing proposal. Used for off-chain
   * mutable-latest sources (Snapshot) where a proposal edit re-derives the same row with changed
   * title/body/voting window. Does NOT touch `state` (route that through `setStateFromDerivation`).
   */
  async updateDerivedFields(input: {
    proposalId: string;
    title: string | null;
    description: string;
    descriptionHash: string;
    votingStartsAt: Date | null;
    votingEndsAt: Date | null;
  }): Promise<void> {
    await this.db
      .updateTable('proposal')
      .set({
        title: input.title,
        description: input.description,
        description_hash: input.descriptionHash,
        voting_starts_at: input.votingStartsAt,
        voting_ends_at: input.votingEndsAt,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', input.proposalId)
      .execute();
  }

  /**
   * Replace a proposal's choice set wholesale (delete-then-insert). `ensureChoices` is INSERT …
   * ON CONFLICT DO NOTHING, so it cannot drop a removed index or update a changed value when an
   * editable off-chain proposal's `choices[]` changes — this does.
   */
  async reindexChoices(proposalId: string, choices: readonly NewProposalChoice[]): Promise<void> {
    await this.db.deleteFrom('proposal_choice').where('proposal_id', '=', proposalId).execute();
    if (choices.length === 0) return;
    await this.db
      .insertInto('proposal_choice')
      .values(choices.map((choice) => ({ ...choice, proposal_id: proposalId })))
      .execute();
  }

  /**
   * Summarizer worklist (M5-2.2): proposals in the given states that are either binding on-chain
   * proposals OR non-binding signaling proposals from a signaling source (Snapshot). Oldest-
   * transition first, capped at `limit`. Template routing (binding vs signaling) and the per-
   * proposal cache dedup happen in the worker; this is just the candidate scan.
   */
  async findSummaryCandidates(states: ProposalState[], limit: number): Promise<Proposal[]> {
    if (states.length === 0) return [];
    return this.db
      .selectFrom('proposal')
      .selectAll()
      .where('state', 'in', states)
      .where((eb) =>
        eb.or([eb('binding', '=', true), eb('source_type', 'in', [...SIGNALING_SOURCE_TYPES])]),
      )
      .orderBy('state_updated_at', 'asc')
      .limit(limit)
      .execute();
  }

  /** Fetch a single proposal by primary key. Used by the real-time summarizer handler, which
   *  receives only the `proposal:<id>` entity ref off the queue. */
  async findById(id: string): Promise<Proposal | undefined> {
    return this.db.selectFrom('proposal').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async findPendingTimestampFill(limit: number): Promise<PendingTimestampFillRow[]> {
    return this.db
      .selectFrom('proposal')
      .innerJoin('dao', 'dao.id', 'proposal.dao_id')
      .select([
        'proposal.id',
        'dao.primary_chain_id as chain_id',
        'proposal.voting_starts_block',
        'proposal.voting_starts_at',
        'proposal.voting_ends_block',
        'proposal.voting_ends_at',
      ])
      .where((eb) =>
        eb.or([
          eb.and([
            eb('proposal.voting_starts_at', 'is', null),
            eb('proposal.voting_starts_block', 'is not', null),
          ]),
          eb.and([
            eb('proposal.voting_ends_at', 'is', null),
            eb('proposal.voting_ends_block', 'is not', null),
          ]),
        ]),
      )
      .orderBy('proposal.voting_starts_block', 'asc')
      .limit(limit)
      .execute();
  }

  async fillTimestamps(rows: readonly TimestampFillInput[]): Promise<void> {
    for (const row of rows) {
      await this.db
        .updateTable('proposal')
        .set((eb) => ({
          voting_starts_at:
            row.voting_starts_at === null
              ? eb.ref('voting_starts_at')
              : eb.fn('coalesce', [eb.ref('voting_starts_at'), eb.val(row.voting_starts_at)]),
          voting_ends_at:
            row.voting_ends_at === null
              ? eb.ref('voting_ends_at')
              : eb.fn('coalesce', [eb.ref('voting_ends_at'), eb.val(row.voting_ends_at)]),
          updated_at: sql<Date>`now()`,
        }))
        .where('id', '=', row.id)
        .execute();
    }
  }
}
