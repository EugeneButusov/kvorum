import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { ProposalExtension, ProposalPayloadView, ProposalVotingView } from '@libs/domain';
import './schema';

export class AaveProposalExtensionReadRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async getExtension(proposalId: string): Promise<ProposalExtension | null> {
    const [metadata, payloads] = await Promise.all([
      this.db
        .selectFrom('aave_proposal_metadata')
        .selectAll()
        .where('proposal_id', '=', proposalId)
        .executeTakeFirst(),
      this.db
        .selectFrom('aave_proposal_payload')
        .selectAll()
        .where('proposal_id', '=', proposalId)
        .orderBy('payload_index', 'asc')
        .execute(),
    ]);

    if (metadata === undefined) return null;

    const voting: ProposalVotingView = {
      voting_chain_id: metadata.voting_chain_id,
      voting_machine_address: metadata.voting_machine_address,
      voting_strategy_address: metadata.voting_strategy_address,
      creation_block: metadata.creation_block,
    };

    const payloadViews: ProposalPayloadView[] = payloads.map((p) => ({
      payload_index: p.payload_index,
      target_chain_id: p.target_chain_id,
      payloads_controller_address: p.payloads_controller_address,
      payload_id: p.payload_id,
      status: p.status,
      executed_at_destination:
        p.executed_at_destination === null ? null : toIsoSeconds(p.executed_at_destination),
      unindexed_target_chain: p.unindexed_target_chain,
    }));

    return { voting, payloads: payloadViews, metadata: null };
  }
}

function toIsoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
