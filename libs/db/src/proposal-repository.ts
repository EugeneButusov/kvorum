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
  targetState: Extract<ProposalState, 'queued' | 'executed' | 'canceled'>;
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

  async findIdBySource(
    daoId: string,
    sourceType: string,
    sourceId: string,
  ): Promise<string | undefined> {
    const proposal = await this.findBySource({ daoId, sourceType, sourceId });
    return proposal?.id;
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

  async insertActions(proposalId: string, actions: readonly ProposalActionInput[]): Promise<void> {
    if (actions.length === 0) return;

    const rows: NewProposalAction[] = actions.map((action, index) => ({
      proposal_id: proposalId,
      action_index: index,
      target_address: action.targetAddress.toLowerCase(),
      target_chain_id: action.targetChainId,
      value_wei: action.valueWei,
      function_signature: action.functionSignature,
      calldata: action.calldata,
    }));

    await this.db
      .insertInto('proposal_action')
      .values(rows)
      .onConflict((oc) => oc.columns(['proposal_id', 'action_index']).doNothing())
      .execute();
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
    const allowedCurrentStates: readonly ProposalState[] =
      input.targetState === 'queued' ? ['pending'] : ['pending', 'queued'];

    const query = this.db
      .updateTable('proposal')
      .where('dao_id', '=', input.daoId)
      .where('source_type', '=', input.sourceType)
      .where('source_id', '=', input.sourceId)
      .where('state', 'not in', ['executed', 'canceled'])
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
              : sql`coalesce(voting_starts_at, ${row.voting_starts_at})`,
          voting_ends_at:
            row.voting_ends_at === null
              ? eb.ref('voting_ends_at')
              : sql`coalesce(voting_ends_at, ${row.voting_ends_at})`,
          updated_at: sql`now()`,
        }))
        .where('id', '=', row.id)
        .execute();
    }
  }
}
