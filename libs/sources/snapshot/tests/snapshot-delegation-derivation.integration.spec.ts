import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Logger } from '@libs/chain';
import { ArchiveDerivationRepository, ZERO_DELEGATE_ADDRESS, chDb, pgDb } from '@libs/db';
import type { ArchiveDerivationRow } from '@libs/db';
import '../src/persistence/schema';
import { DelegateRegistryDelegationProjectionApplier } from '../src/delegate-registry/domain/delegation-projection-applier';
import { DelegateRegistryArchivePayloadRepository } from '../src/delegate-registry/persistence/archive-payload-repository';
import { encodeSpaceId } from '../src/delegation/address';
import { SnapshotDelegationRepository } from '../src/delegation/snapshot-delegation-repository';
import { SnapshotSpaceDaoResolver } from '../src/delegation/space-dao-resolver';
import { SplitDelegationProjectionApplier } from '../src/split-delegation/domain/delegation-projection-applier';
import { SplitDelegationArchivePayloadRepository } from '../src/split-delegation/persistence/archive-payload-repository';

const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const noopMetrics = { processed() {} };

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const SPACE = 'lido-snapshot.eth';
const DELEGATOR = `0x${'11'.repeat(20)}`;

describeIf('snapshot delegation derivation (integration)', () => {
  const delegationRepo = new SnapshotDelegationRepository(pgDb);
  const spaceResolver = new SnapshotSpaceDaoResolver(pgDb);
  const archive = new ArchiveDerivationRepository(pgDb);

  const registryApplier = new DelegateRegistryDelegationProjectionApplier({
    archive,
    dlq: { insert: async () => undefined } as never,
    payloads: new DelegateRegistryArchivePayloadRepository(chDb),
    delegationRepo,
    spaceResolver,
    metrics: noopMetrics,
    network: '0x1',
    logger: noopLogger,
  });
  const splitApplier = new SplitDelegationProjectionApplier({
    archive,
    dlq: { insert: async () => undefined } as never,
    payloads: new SplitDelegationArchivePayloadRepository(chDb),
    delegationRepo,
    spaceResolver,
    metrics: noopMetrics,
    network: '0x1',
    logger: noopLogger,
  });

  let registrySourceId = '';
  let splitSourceId = '';
  let nonce = 0;

  beforeEach(async () => {
    await sql`TRUNCATE snapshot_delegation, archive_event RESTART IDENTITY CASCADE`.execute(pgDb);
    registrySourceId = await sourceId('snapshot_delegate_registry');
    splitSourceId = await sourceId('snapshot_split_delegation');
  });

  afterAll(async () => {
    await chDb.destroy();
  });

  async function sourceId(sourceType: string): Promise<string> {
    const row = await pgDb
      .selectFrom('dao_source')
      .select('id')
      .where('source_type', '=', sourceType)
      .where('chain_id', '=', '0x1')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async function archiveEvent(
    table: 'archive_event_snapshot_delegate_registry' | 'archive_event_snapshot_split_delegation',
    daoSourceId: string,
    sourceType: string,
    eventType: string,
    payload: unknown,
    block: number,
    log: number,
  ): Promise<ArchiveDerivationRow> {
    const txHash = `0x${(nonce++).toString(16).padStart(64, '0')}`;
    const blockHash = `0x${'ab'.repeat(32)}`;
    const row = await pgDb
      .insertInto('archive_event')
      .values({
        source_type: sourceType,
        dao_source_id: daoSourceId,
        chain_id: '0x1',
        block_number: String(block),
        block_hash: blockHash,
        tx_hash: txHash,
        log_index: log,
        event_type: eventType,
        received_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await chDb
      .insertInto(table)
      .values({
        dao_source_id: daoSourceId,
        chain_id: '0x1',
        block_number: String(block),
        block_hash: blockHash,
        tx_hash: txHash,
        log_index: log,
        event_type: eventType,
        payload: JSON.stringify(payload),
      } as never)
      .execute();
    return {
      id: row.id,
      source_type: sourceType,
      dao_source_id: daoSourceId,
      chain_id: '0x1',
      block_number: String(block),
      block_hash: blockHash,
      tx_hash: txHash,
      log_index: log,
      event_type: eventType,
      received_at: new Date(),
      derivation_attempt_count: 0,
    } as ArchiveDerivationRow;
  }

  function setDelegate(id: string, delegate: string) {
    return { delegator: DELEGATOR, id, delegate };
  }

  it('derives a space-specific SetDelegate into snapshot_delegation with the resolved dao', async () => {
    const row = await archiveEvent(
      'archive_event_snapshot_delegate_registry',
      registrySourceId,
      'snapshot_delegate_registry',
      'SetDelegate',
      setDelegate(encodeSpaceId(SPACE), `0x${'22'.repeat(20)}`),
      100,
      0,
    );
    await registryApplier.applyBatch([row]);

    const current = await delegationRepo.findCurrentDelegateRegistryDelegation(
      DELEGATOR,
      SPACE,
      '0x1',
    );
    expect(current?.delegate_address).toBe(`0x${'22'.repeat(20)}`);

    const stored = await pgDb
      .selectFrom('snapshot_delegation')
      .selectAll()
      .where('delegator_address', '=', DELEGATOR)
      .executeTakeFirstOrThrow();
    expect(stored.space_id).toBe(SPACE);
    expect(stored.dao_id).not.toBeNull();
  });

  it('applies space-over-global precedence, falling back to global when the space is cleared', async () => {
    const global = await archiveEvent(
      'archive_event_snapshot_delegate_registry',
      registrySourceId,
      'snapshot_delegate_registry',
      'SetDelegate',
      setDelegate(`0x${'00'.repeat(32)}`, `0x${'aa'.repeat(20)}`),
      90,
      0,
    );
    const spaceSet = await archiveEvent(
      'archive_event_snapshot_delegate_registry',
      registrySourceId,
      'snapshot_delegate_registry',
      'SetDelegate',
      setDelegate(encodeSpaceId(SPACE), `0x${'bb'.repeat(20)}`),
      100,
      0,
    );
    await registryApplier.applyBatch([global, spaceSet]);
    expect(
      (await delegationRepo.findCurrentDelegateRegistryDelegation(DELEGATOR, SPACE, '0x1'))
        ?.delegate_address,
    ).toBe(`0x${'bb'.repeat(20)}`);

    const spaceClear = await archiveEvent(
      'archive_event_snapshot_delegate_registry',
      registrySourceId,
      'snapshot_delegate_registry',
      'ClearDelegate',
      setDelegate(encodeSpaceId(SPACE), `0x${'bb'.repeat(20)}`),
      110,
      0,
    );
    await registryApplier.applyBatch([spaceClear]);
    expect(
      (await delegationRepo.findCurrentDelegateRegistryDelegation(DELEGATOR, SPACE, '0x1'))
        ?.delegate_address,
    ).toBe(`0x${'aa'.repeat(20)}`);
  });

  it('is idempotent across re-derivation (ON CONFLICT DO NOTHING)', async () => {
    const row = await archiveEvent(
      'archive_event_snapshot_delegate_registry',
      registrySourceId,
      'snapshot_delegate_registry',
      'SetDelegate',
      setDelegate(encodeSpaceId(SPACE), `0x${'22'.repeat(20)}`),
      100,
      0,
    );
    await registryApplier.applyBatch([row]);
    await registryApplier.applyBatch([row]);
    const count = await pgDb
      .selectFrom('snapshot_delegation')
      .select(pgDb.fn.countAll().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
  });

  it('fans a Split Delegation DelegationUpdated into weighted rows', async () => {
    const d1 = `0x${'00'.repeat(12)}${'22'.repeat(20)}`;
    const d2 = `0x${'00'.repeat(12)}${'33'.repeat(20)}`;
    const row = await archiveEvent(
      'archive_event_snapshot_split_delegation',
      splitSourceId,
      'snapshot_split_delegation',
      'DelegationUpdated',
      {
        account: DELEGATOR,
        context: SPACE,
        delegation: [
          { delegate: d1, ratio: '3' },
          { delegate: d2, ratio: '1' },
        ],
        expirationTimestamp: '0',
      },
      200,
      0,
    );
    await splitApplier.applyBatch([row]);

    const current = await delegationRepo.findCurrentSplitDelegation(
      DELEGATOR,
      SPACE,
      '0x1',
      new Date(),
    );
    expect(current).toHaveLength(2);
    const weights = current.map((c) => c.weight).sort();
    expect(weights).toEqual(['0.25', '0.75']);
    expect(current.every((c) => c.delegate_address !== ZERO_DELEGATE_ADDRESS)).toBe(true);
  });
});
