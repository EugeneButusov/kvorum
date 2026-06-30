import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Logger } from '@libs/chain';
import {
  ArchiveDerivationRepository,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
  chDb,
  pgDb,
} from '@libs/db';
import '../src/persistence/schema';
import { SnapshotVoteProjectionApplier } from '../src/domain/vote-projection-applier';
import { makeSnapshotOffChainArchiveWriter } from '../src/ingestion/archive-writer';
import { SnapshotArchivePayloadRepository } from '../src/persistence/archive-payload-repository';
import { SnapshotProposalRepository } from '../src/persistence/snapshot-proposal-repository';
import { SnapshotVoteChoiceRepository } from '../src/persistence/snapshot-vote-choice-repository';

const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

describeIf('snapshot vote derivation (integration)', () => {
  let daoSourceId = '';
  let daoId = '';
  let proposalId = '';
  const proposalSourceId = `0xprop-${Date.now()}`;

  const voteRead = new VoteEventsProjectionReadRepository(chDb);
  const applier = new SnapshotVoteProjectionApplier({
    payloads: new SnapshotArchivePayloadRepository(chDb),
    proposals: new ProposalRepository(pgDb),
    snapshotProposals: new SnapshotProposalRepository(pgDb),
    voteRead,
    voteWrite: new VoteEventsProjectionWriter(chDb),
    voteChoice: new SnapshotVoteChoiceRepository(chDb),
    archive: new ArchiveDerivationRepository(pgDb),
    logger: noopLogger,
  });
  const voteChoiceRepo = new SnapshotVoteChoiceRepository(chDb);
  const writeCh = makeSnapshotOffChainArchiveWriter({ chDb });

  beforeEach(async () => {
    await sql`TRUNCATE proposal, snapshot_proposal_metadata, proposal_choice, archive_event, actor, actor_address RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    const src = await pgDb
      .selectFrom('dao_source as ds')
      .innerJoin('dao as d', 'd.id', 'ds.dao_id')
      .select(['ds.id as id', 'd.id as dao_id'])
      .where('d.slug', '=', 'lido')
      .where('ds.source_type', '=', 'snapshot')
      .where('ds.chain_id', '=', 'off-chain')
      .executeTakeFirstOrThrow();
    daoSourceId = src.id;
    daoId = src.dao_id;

    const actor = await pgDb
      .insertInto('actor')
      .values({ primary_address: '0x' + '99'.repeat(20), updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const proposal = await pgDb
      .insertInto('proposal')
      .values({
        dao_id: daoId,
        source_type: 'snapshot',
        source_id: proposalSourceId,
        proposer_actor_id: actor.id,
        title: 'P',
        description: '',
        description_hash: 'h',
        binding: false,
        state: 'succeeded',
        state_updated_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    proposalId = proposal.id;
    await pgDb
      .insertInto('proposal_choice')
      .values([
        { proposal_id: proposalId, choice_index: 0, value: 'For' },
        { proposal_id: proposalId, choice_index: 1, value: 'Against' },
        { proposal_id: proposalId, choice_index: 2, value: 'Abstain' },
      ])
      .execute();
    await pgDb
      .insertInto('snapshot_proposal_metadata')
      .values({
        proposal_id: proposalId,
        space_id: 'lido-snapshot.eth',
        voting_type: 'weighted',
        network: '1',
      })
      .execute();
  });

  afterAll(async () => {
    await chDb.destroy();
  });

  async function archiveVote(
    voteId: string,
    voter: string,
    choice: unknown,
    vp: number,
    created: number,
  ) {
    const externalId = `vote:${voteId}`;
    const archiveRow = await pgDb
      .insertInto('archive_event')
      .values({
        source_type: 'snapshot',
        dao_source_id: daoSourceId,
        chain_id: 'off-chain',
        external_id: externalId,
        derivation_ordinal: String(created),
        content_hash: `h-${voteId}`,
        version: 1,
        event_type: 'SnapshotVoteCast',
        received_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await writeCh(
      { daoSourceId, sourceType: 'snapshot', chainId: 'off-chain', sourceLabel: 'snapshot' },
      {
        externalId,
        contentHash: `h-${voteId}`,
        ordinal: String(created),
        version: 1,
        payload: {
          id: voteId,
          voter,
          choice,
          vp,
          vp_by_strategy: [vp],
          created,
          proposal: { id: proposalSourceId },
        },
      },
    );
    return {
      id: archiveRow.id,
      source_type: 'snapshot',
      dao_source_id: daoSourceId,
      chain_id: 'off-chain',
      external_id: externalId,
      derivation_ordinal: String(created),
      event_type: 'SnapshotVoteCast' as const,
      received_at: new Date(),
      derivation_attempt_count: 0,
    };
  }

  it('derives a weighted vote: primary_choice, rounded vp, voting_chain_id, and the breakdown', async () => {
    const voter = '0x' + '11'.repeat(20);
    const row = await archiveVote('0xvote1', voter, { '1': 3, '2': 1 }, 1234.6, 1_700_000_000);

    await applier.applyBatch([row]);

    const current = await voteRead.findCurrentVote({ daoId, proposalId, voterAddress: voter });
    expect(current?.primary_choice).toBe(0); // option 1 (highest weight) → 0-based
    expect(current?.voting_power).toBe('1235'); // round(1234.6)
    expect(current?.voting_chain_id).toBe('0x1'); // network 1

    const choices = await voteChoiceRepo.findByVoteId(row.id);
    expect(choices?.[0]).toEqual({ choice_index: 0, weight: '0.75' });
    expect(choices?.[1]).toEqual({ choice_index: 1, weight: '0.25' });
  });

  it('a re-cast supersedes the prior vote (single current-vote invariant)', async () => {
    const voter = '0x' + '22'.repeat(20);
    const first = await archiveVote('0xvoteA', voter, { '1': 1 }, 10, 1_700_000_000);
    await applier.applyBatch([first]);
    const recast = await archiveVote('0xvoteB', voter, { '2': 1 }, 10, 1_700_000_900);
    await applier.applyBatch([recast]);

    // findCurrentVote reads WHERE superseded=0; it returning the re-cast confirms the prior vote
    // was superseded and the single-current-vote invariant holds (the unit test covers the 2-row emit).
    const current = await voteRead.findCurrentVote({ daoId, proposalId, voterAddress: voter });
    expect(current?.vote_id).toBe(recast.id);
    expect(current?.primary_choice).toBe(1); // option 2 → 0-based
  });
});
