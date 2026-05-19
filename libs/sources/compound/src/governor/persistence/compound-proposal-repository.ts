import { sql, type Kysely } from 'kysely';
import type { PgDatabase, ProposalState } from '@libs/db';
import './schema';

export interface ReconcilePerChainBound {
  chainId: string;
  confirmedThresholdBlock: string;
}

export interface StaleReconciliationRow {
  id: string;
  source_id: string;
  source_type: string;
  chain_id: string;
  governor_address: string;
  state: ProposalState;
  voting_starts_block: string | null;
  voting_ends_block: string | null;
  queued_at_block: string | null;
}

export interface ReconcileStateInput {
  proposalId: string;
  expectedStates: readonly ProposalState[];
  targetState: Extract<ProposalState, 'defeated' | 'expired' | 'active'>;
  stateUpdatedAt: Date;
}

export class CompoundProposalRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findStaleForReconciliation(
    sourceTypes: readonly string[],
    perChainBounds: readonly ReconcilePerChainBound[],
    recheckGapBlocks: number,
    limit: number,
  ): Promise<StaleReconciliationRow[]> {
    if (sourceTypes.length === 0 || perChainBounds.length === 0 || limit <= 0) return [];

    return this.db
      .selectFrom('proposal')
      .innerJoin('dao', 'dao.id', 'proposal.dao_id')
      .innerJoin('dao_source', (join) =>
        join
          .onRef('dao_source.dao_id', '=', 'proposal.dao_id')
          .onRef('dao_source.source_type', '=', 'proposal.source_type'),
      )
      .leftJoin('compound_proposal_meta', 'compound_proposal_meta.proposal_id', 'proposal.id')
      .select([
        'proposal.id',
        'proposal.source_id',
        'proposal.source_type',
        'dao.primary_chain_id as chain_id',
        sql<string>`dao_source.source_config ->> 'governor_address'`.as('governor_address'),
        'proposal.state',
        'proposal.voting_starts_block',
        'proposal.voting_ends_block',
        'compound_proposal_meta.queued_at_block',
      ])
      .where('proposal.source_type', 'in', sourceTypes)
      .where('proposal.state', 'in', ['pending', 'active', 'succeeded', 'queued'])
      .where((eb) =>
        eb.or(
          perChainBounds.map((bound) =>
            eb.and([
              eb('dao.primary_chain_id', '=', bound.chainId),
              eb.or([
                eb('compound_proposal_meta.last_reconcile_check_block', 'is', null),
                eb(
                  'compound_proposal_meta.last_reconcile_check_block',
                  '<',
                  String(BigInt(bound.confirmedThresholdBlock) - BigInt(recheckGapBlocks)),
                ),
              ]),
              eb.or([
                eb.and([
                  eb('proposal.state', 'in', ['pending', 'active', 'succeeded']),
                  eb('proposal.voting_ends_block', 'is not', null),
                  eb('proposal.voting_ends_block', '<', bound.confirmedThresholdBlock),
                ]),
                eb.and([
                  eb('proposal.state', '=', 'queued'),
                  eb.or([
                    eb.and([
                      eb('compound_proposal_meta.queued_at_block', 'is not', null),
                      eb(
                        'compound_proposal_meta.queued_at_block',
                        '<',
                        bound.confirmedThresholdBlock,
                      ),
                    ]),
                    eb.and([
                      eb('compound_proposal_meta.queued_at_block', 'is', null),
                      eb('proposal.voting_ends_block', 'is not', null),
                      eb('proposal.voting_ends_block', '<', bound.confirmedThresholdBlock),
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ),
        ),
      )
      .orderBy('proposal.voting_ends_block', 'asc')
      .limit(limit)
      .execute();
  }

  async reconcileState(input: ReconcileStateInput): Promise<number> {
    const result = await this.db
      .updateTable('proposal')
      .set({
        state: input.targetState,
        state_updated_at: input.stateUpdatedAt,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', input.proposalId)
      .where('state', 'in', input.expectedStates)
      .where('state', '<>', input.targetState)
      .executeTakeFirst();

    return Number(result?.numUpdatedRows ?? 0n);
  }

  async markReconcileChecked(proposalId: string, confirmedThreshold: string): Promise<void> {
    await this.db
      .insertInto('compound_proposal_meta')
      .values({ proposal_id: proposalId, last_reconcile_check_block: confirmedThreshold })
      .onConflict((oc) =>
        oc.column('proposal_id').doUpdateSet({ last_reconcile_check_block: confirmedThreshold }),
      )
      .execute();
  }

  async upsertQueuedBlock(
    daoId: string,
    sourceType: string,
    sourceId: string,
    queuedAtBlock: string,
  ): Promise<void> {
    await sql`
      INSERT INTO compound_proposal_meta (proposal_id, queued_at_block)
      SELECT id, ${sql.lit(queuedAtBlock)}
      FROM proposal
      WHERE dao_id = ${sql.lit(daoId)}
        AND source_type = ${sql.lit(sourceType)}
        AND source_id = ${sql.lit(sourceId)}
      ON CONFLICT (proposal_id)
        DO UPDATE SET queued_at_block = excluded.queued_at_block
    `.execute(this.db);
  }
}
