import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Logger } from '@libs/chain';
import { ArchiveDerivationRepository, chDb, pgDb } from '@libs/db';
import '../src/persistence/schema';
import { SnapshotProposalProjectionApplier } from '../src/domain/proposal-projection-applier';
import { makeSnapshotOffChainArchiveWriter } from '../src/ingestion/archive-writer';
import { SnapshotArchivePayloadRepository } from '../src/persistence/archive-payload-repository';

const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const SPACE = 'lido-snapshot.eth';

function proposalPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: `0xprop-${Date.now()}`,
    created: 1_700_000_000,
    title: 'Integration proposal',
    body: 'body text',
    choices: ['For', 'Against', 'Abstain'],
    type: 'single-choice',
    start: 1_700_000_100,
    end: 1_700_000_900,
    state: 'active',
    scores: [3, 1, 0],
    scores_total: 4,
    scores_state: 'pending',
    author: '0x' + 'ab'.repeat(20),
    ipfs: 'Qm123',
    network: '1',
    flagged: false,
    strategies: [{ name: 'erc20-balance-of' }],
    space: { id: SPACE },
    ...overrides,
  };
}

describeIf('snapshot proposal derivation (integration)', () => {
  let daoSourceId = '';
  const applier = new SnapshotProposalProjectionApplier({
    pgDb,
    payloads: new SnapshotArchivePayloadRepository(chDb),
    archive: new ArchiveDerivationRepository(pgDb),
    logger: noopLogger,
  });
  const writeCh = makeSnapshotOffChainArchiveWriter({ chDb });

  beforeEach(async () => {
    await sql`TRUNCATE proposal, snapshot_proposal_metadata, proposal_choice, archive_event, actor, actor_address RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    // The lido dao + its snapshot dao_source are seeded by the lido/snapshot migrations.
    const src = await pgDb
      .selectFrom('dao_source as ds')
      .innerJoin('dao as d', 'd.id', 'ds.dao_id')
      .select('ds.id as id')
      .where('d.slug', '=', 'lido')
      .where('ds.source_type', '=', 'snapshot')
      .where('ds.chain_id', '=', 'off-chain')
      .executeTakeFirstOrThrow();
    daoSourceId = src.id;
  });

  afterAll(async () => {
    await chDb.destroy();
  });

  async function archiveAndBuildRow(payload: Record<string, unknown>, version: number) {
    const externalId = `prop:${payload['id'] as string}`;
    const contentHash = `hash-v${version}`;
    const archiveRow = await pgDb
      .insertInto('archive_event')
      .values({
        source_type: 'snapshot',
        dao_source_id: daoSourceId,
        chain_id: 'off-chain',
        external_id: externalId,
        derivation_ordinal: String(payload['created']),
        content_hash: contentHash,
        version,
        event_type: 'SnapshotProposalCreated',
        received_at: new Date(),
      })
      .onConflict((oc) =>
        oc
          .columns(['source_type', 'chain_id', 'external_id'])
          .where('external_id', 'is not', null)
          .doUpdateSet({ content_hash: contentHash, version, derived_at: null }),
      )
      .returning(['id'])
      .executeTakeFirstOrThrow();
    await writeCh(
      { daoSourceId, sourceType: 'snapshot', chainId: 'off-chain', sourceLabel: 'snapshot' },
      { externalId, contentHash, ordinal: String(payload['created']), version, payload },
    );
    return {
      id: archiveRow.id,
      source_type: 'snapshot',
      dao_source_id: daoSourceId,
      chain_id: 'off-chain',
      external_id: externalId,
      derivation_ordinal: String(payload['created']),
      event_type: 'SnapshotProposalCreated' as const,
      received_at: new Date(),
      derivation_attempt_count: 0,
    };
  }

  it('derives a proposal + metadata + choices, then re-derives an edit', async () => {
    const payload = proposalPayload();
    const row = await archiveAndBuildRow(payload, 1);

    await applier.applyBatch([row]);

    const proposal = await pgDb
      .selectFrom('proposal')
      .selectAll()
      .where('source_id', '=', payload.id)
      .executeTakeFirstOrThrow();
    expect(proposal.title).toBe('Integration proposal');
    expect(proposal.binding).toBe(false);
    expect(proposal.state).toBe('active');

    const metadata = await pgDb
      .selectFrom('snapshot_proposal_metadata')
      .selectAll()
      .where('proposal_id', '=', proposal.id)
      .executeTakeFirstOrThrow();
    expect(metadata.space_id).toBe(SPACE);
    expect(metadata.voting_type).toBe('single-choice');

    const choices = await pgDb
      .selectFrom('proposal_choice')
      .selectAll()
      .where('proposal_id', '=', proposal.id)
      .orderBy('choice_index')
      .execute();
    expect(choices.map((c) => c.value)).toEqual(['For', 'Against', 'Abstain']);

    const derived = await pgDb
      .selectFrom('archive_event')
      .select('derived_at')
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(derived.derived_at).not.toBeNull();

    // Edit: closed + final + 2 choices → update fields, reindex choices, finalize state.
    const edited = proposalPayload({
      id: payload.id,
      title: 'Edited title',
      choices: ['Yes', 'No'],
      state: 'closed',
      scores_state: 'final',
      scores_total: 9,
    });
    const editedRow = await archiveAndBuildRow(edited, 2);
    await applier.applyBatch([editedRow]);

    const after = await pgDb
      .selectFrom('proposal')
      .selectAll()
      .where('source_id', '=', payload.id)
      .executeTakeFirstOrThrow();
    expect(after.title).toBe('Edited title');
    expect(after.state).toBe('succeeded');
    const afterChoices = await pgDb
      .selectFrom('proposal_choice')
      .selectAll()
      .where('proposal_id', '=', after.id)
      .orderBy('choice_index')
      .execute();
    expect(afterChoices.map((c) => c.value)).toEqual(['Yes', 'No']);
  });

  it('does not create a proposal for a flagged payload', async () => {
    const payload = proposalPayload({ flagged: true });
    const row = await archiveAndBuildRow(payload, 1);

    await applier.applyBatch([row]);

    const count = await pgDb
      .selectFrom('proposal')
      .select(pgDb.fn.countAll().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(0);
    const derived = await pgDb
      .selectFrom('archive_event')
      .select('derived_at')
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(derived.derived_at).not.toBeNull();
  });
});
