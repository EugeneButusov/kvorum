import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  ArchiveEventRepository,
} from '@libs/db';
import {
  insertTestDao,
  insertTestDaoSource,
  pgDb,
  truncateAllTestTables,
} from './helpers/pg-test-fixtures';

// Off-chain archive_event identity (ADR-071; archive_event schema in 0002_core_domain).
// Exercises the two partial unique indexes, the identity-shape CHECK, the repository
// find/insert per shape, and the EVM read-path guard against a real Postgres.
const DB_URL = process.env['DATABASE_URL'];
const describeIf = DB_URL ? describe : describe.skip;

const EVM_CHAIN_ID = '0x7a69';
const OFFCHAIN_CHAIN_ID = 'off-chain';
const EVM_SOURCE_TYPE = 'evm_source';
const OFFCHAIN_SOURCE_TYPE = 'offchain_source';

describeIf('archive_event off-chain identity', () => {
  let repo: ArchiveEventRepository;
  let evmDaoSourceId = '';
  let offchainDaoSourceId = '';

  beforeAll(async () => {
    repo = new ArchiveEventRepository(pgDb);
    const daoId = await insertTestDao(pgDb, {
      slug: 'offchain-id-dao',
      name: 'Off-chain Identity DAO',
    });
    evmDaoSourceId = await insertTestDaoSource(pgDb, {
      daoId,
      sourceType: EVM_SOURCE_TYPE,
      chainId: EVM_CHAIN_ID,
      contractAddress: '0x' + '11'.repeat(20),
    });
    offchainDaoSourceId = await insertTestDaoSource(pgDb, {
      daoId,
      sourceType: OFFCHAIN_SOURCE_TYPE,
      chainId: OFFCHAIN_CHAIN_ID,
      contractAddress: '0x' + '22'.repeat(20),
    });
  });

  beforeEach(async () => {
    await sql`TRUNCATE archive_event RESTART IDENTITY CASCADE`.execute(pgDb);
  });

  afterAll(async () => {
    await truncateAllTestTables(pgDb);
  });

  function evmRow(logIndex: number) {
    return {
      source_type: EVM_SOURCE_TYPE,
      dao_source_id: evmDaoSourceId,
      chain_id: EVM_CHAIN_ID,
      block_number: '100',
      block_hash: '0xblock',
      tx_hash: '0xtx',
      log_index: logIndex,
      event_type: 'ProposalCreated' as const,
      received_at: new Date(),
      derived_at: null,
    };
  }

  function offchainRow(externalId: string, derivationOrdinal?: number) {
    return {
      source_type: OFFCHAIN_SOURCE_TYPE,
      dao_source_id: offchainDaoSourceId,
      chain_id: OFFCHAIN_CHAIN_ID,
      external_id: externalId,
      derivation_ordinal: derivationOrdinal != null ? String(derivationOrdinal) : null,
      event_type: 'ProposalCreated' as const,
      received_at: new Date(),
      derived_at: null,
    };
  }

  it('inserts an EVM row and an off-chain row that coexist', async () => {
    const evm = await repo.insert(evmRow(1));
    const off = await repo.insert(offchainRow('proposal-0xabc'));

    expect(evm?.id).toBeDefined();
    expect(off?.id).toBeDefined();

    const count = await pgDb
      .selectFrom('archive_event')
      .select(({ fn }) => fn.countAll<string>().as('c'))
      .executeTakeFirstOrThrow();
    expect(Number(count.c)).toBe(2);
  });

  it('re-inserting an EVM row is idempotent (own 4-tuple index fires)', async () => {
    const first = await repo.insert(evmRow(1));
    const second = await repo.insert(evmRow(1));

    expect(first?.id).toBeDefined();
    expect(second).toBeUndefined(); // DO NOTHING returns no row

    const found = await repo.find({
      sourceType: EVM_SOURCE_TYPE,
      chainId: EVM_CHAIN_ID,
      txHash: '0xtx',
      logIndex: 1,
    });
    expect(found?.id).toBe(first?.id);
  });

  it('re-inserting an off-chain row is idempotent (own external_id index fires)', async () => {
    const first = await repo.insert(offchainRow('proposal-0xabc'));
    const second = await repo.insert(offchainRow('proposal-0xabc'));

    expect(first?.id).toBeDefined();
    expect(second).toBeUndefined();

    const found = await repo.findByExternalId({
      sourceType: OFFCHAIN_SOURCE_TYPE,
      chainId: OFFCHAIN_CHAIN_ID,
      externalId: 'proposal-0xabc',
    });
    expect(found?.id).toBe(first?.id);
  });

  it('find() and findByExternalId() each resolve only their own shape', async () => {
    await repo.insert(evmRow(1));
    await repo.insert(offchainRow('proposal-0xabc'));

    // EVM 4-tuple lookup must not match the off-chain row, and vice versa.
    const evmByTuple = await repo.find({
      sourceType: EVM_SOURCE_TYPE,
      chainId: EVM_CHAIN_ID,
      txHash: '0xtx',
      logIndex: 1,
    });
    expect(evmByTuple?.id).toBeDefined();

    const missByExternal = await repo.findByExternalId({
      sourceType: EVM_SOURCE_TYPE,
      chainId: EVM_CHAIN_ID,
      externalId: 'proposal-0xabc',
    });
    expect(missByExternal).toBeUndefined();
  });

  it('CHECK rejects a malformed row (both shapes present)', async () => {
    await expect(
      pgDb
        .insertInto('archive_event')
        .values({
          ...evmRow(1),
          external_id: 'proposal-0xabc', // both 4-tuple AND external_id → violates the CHECK
        })
        .execute(),
    ).rejects.toThrow(/archive_event_identity_shape/);
  });

  it('CHECK rejects a malformed row (neither shape present)', async () => {
    await expect(
      pgDb
        .insertInto('archive_event')
        .values({
          source_type: OFFCHAIN_SOURCE_TYPE,
          dao_source_id: offchainDaoSourceId,
          chain_id: OFFCHAIN_CHAIN_ID,
          event_type: 'ProposalCreated',
          received_at: new Date(),
          derived_at: null,
          // no coords, no external_id
        })
        .execute(),
    ).rejects.toThrow(/archive_event_identity_shape/);
  });

  it('off-chain derivation reads order by derivation_ordinal, not insertion order', async () => {
    // Insert out of ordinal order; expect them back sorted by derivation_ordinal.
    await repo.insert(offchainRow('proposal-c', 30));
    await repo.insert(offchainRow('proposal-a', 10));
    await repo.insert(offchainRow('proposal-b', 20));

    const derivation = new ArchiveDerivationRepository(pgDb);
    const offchain = await derivation.findUnderivedOffchain(['ProposalCreated'], 50);
    expect(offchain.map((r) => r.external_id)).toEqual(['proposal-a', 'proposal-b', 'proposal-c']);
    expect(offchain.map((r) => r.derivation_ordinal)).toEqual(['10', '20', '30']);
    // These rows have no block coords — only the off-chain shape is returned here.
    expect(offchain.every((r) => r.external_id != null)).toBe(true);
  });

  it('off-chain reads exclude EVM rows (mirror of the EVM guard)', async () => {
    await repo.insert(evmRow(1));
    await repo.insert(offchainRow('proposal-a', 10));

    const derivation = new ArchiveDerivationRepository(pgDb);
    const offchain = await derivation.findUnderivedOffchain(['ProposalCreated'], 50);
    expect(offchain).toHaveLength(1);
    expect(offchain[0]?.source_type).toBe(OFFCHAIN_SOURCE_TYPE);
  });

  it('EVM derivation reads exclude off-chain rows even with a shared event_type', async () => {
    await repo.insert(evmRow(1));
    await repo.insert(offchainRow('proposal-0xabc')); // same event_type 'ProposalCreated'

    const derivation = new ArchiveDerivationRepository(pgDb);
    const underived = await derivation.findUnderived(['ProposalCreated'], 50);
    expect(underived).toHaveLength(1);
    expect(underived[0]?.source_type).toBe(EVM_SOURCE_TYPE);
    // The guard guarantees non-null coords on every returned row.
    expect(underived[0]?.tx_hash).toBe('0xtx');

    const actorResolution = new ArchiveActorResolutionRepository(pgDb);
    const unresolved = await actorResolution.findUnresolvedActors(['ProposalCreated'], 5, 50);
    expect(unresolved.every((r) => r.source_type === EVM_SOURCE_TYPE)).toBe(true);
  });
});
