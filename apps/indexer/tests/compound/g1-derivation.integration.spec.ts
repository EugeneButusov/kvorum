import type { INestApplicationContext } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChainContextRegistry, silentLogger } from '@libs/chain';
import { ConfirmationRepository, DlqRepository, pgDb, chDb } from '@libs/db';
import { ArchiveWriter, EventRepository, createCompoundPlugins } from '@sources/compound';
import type { SourcePlugin } from '@sources/core';
import { SOURCE_PLUGINS } from '@sources/core';
import { DerivationWorkerService } from '../../src/derivation/derivation-worker.service';
import {
  COMPOUND_EMITTER_DEPLOY_BYTECODE,
  EMIT_VALID_SELECTOR,
} from '../_fixtures/compound-emitter.bytecode';
import { TestEvmIndexerModule } from '../_fixtures/test-evm-indexer.module';
import {
  insertTestDao,
  insertTestDaoSource,
  pollUntil,
  truncateAllIngestionTables,
  truncateAllTestTables,
} from '../helpers/pg-test-fixtures';

const ANVIL_URL = process.env['ANVIL_RPC_URL'];
const DB_URL = process.env['DATABASE_URL'];

const describeIf = ANVIL_URL && DB_URL ? describe : describe.skip;

@Module({
  imports: [TestEvmIndexerModule],
  providers: [
    {
      provide: SOURCE_PLUGINS,
      useFactory: (): SourcePlugin[] => {
        const confirmationRepo = new ConfirmationRepository(pgDb);
        const dlqRepo = new DlqRepository(pgDb);
        const archiveWriter = new ArchiveWriter({
          eventRepo: new EventRepository({ chDb }),
          confirmationRepo,
          dlqRepo,
          logger: silentLogger,
        });
        return createCompoundPlugins({ archiveWriter, dlqRepo, logger: silentLogger }).map((p) => ({
          ...p,
          supportedChainIds: ['0x7a69'],
        }));
      },
    },
  ],
})
class G1DerivationTestModule {}

/** Sends a transaction and polls until the receipt is available. */
async function sendAndWait(
  client: { send: <T>(method: string, params: unknown[]) => Promise<T> },
  tx: { from: string; to?: string; data: string },
): Promise<{ transactionHash: string; blockNumber: string; contractAddress: string | null }> {
  const txHash = await client.send<string>('eth_sendTransaction', [tx]);
  let receipt: {
    transactionHash: string;
    blockNumber: string;
    contractAddress: string | null;
  } | null = null;
  const deadline = Date.now() + 10_000;
  while (!receipt && Date.now() < deadline) {
    receipt = await client.send<typeof receipt>('eth_getTransactionReceipt', [txHash]);
    if (!receipt) await new Promise<void>((r) => setTimeout(r, 100));
  }
  if (!receipt) throw new Error(`Receipt not found for tx ${txHash}`);
  return receipt;
}

describeIf('G1 derivation — compound governor', () => {
  let app: INestApplicationContext;
  let client: { send: <T>(method: string, params: unknown[]) => Promise<T> };
  let contractAddress: string;
  let accounts: string[];
  let daoSourceId: string;

  beforeAll(async () => {
    await truncateAllTestTables(pgDb);
    process.env['CHAIN_CONFIG'] = JSON.stringify({
      chains: [
        {
          chainId: '0x7a69',
          name: 'anvil',
          reorgHorizon: 12,
          headPollIntervalMs: 200,
          sweepIntervalMs: 500,
          eventPollIntervalMs: 200,
          providers: [
            { name: 'anvil', url: ANVIL_URL, kind: 'http', priority: 1, timeoutMs: 4_000 },
          ],
        },
      ],
    });

    const deployClient = (await import('@libs/chain').then(
      ({ FailoverRpcClient }) =>
        new FailoverRpcClient({
          chainId: '0x7a69',
          name: 'anvil',
          reorgHorizon: 12,
          providers: [
            { name: 'anvil', url: ANVIL_URL!, kind: 'http', priority: 1, timeoutMs: 4_000 },
          ],
        }),
    )) as {
      send: <T>(method: string, params: unknown[]) => Promise<T>;
      start: () => Promise<void>;
      stop: () => Promise<void>;
    };
    await deployClient.start();

    accounts = await deployClient.send<string[]>('eth_accounts', []);
    const receipt = await sendAndWait(deployClient, {
      from: accounts[0]!,
      data: COMPOUND_EMITTER_DEPLOY_BYTECODE,
    });
    contractAddress = receipt.contractAddress!.toLowerCase();
    await deployClient.stop();

    const daoId = await insertTestDao(pgDb, {
      slug: 'compound-g1-derivation',
      name: 'Compound G1 Derivation Test',
    });
    daoSourceId = await insertTestDaoSource(pgDb, {
      daoId,
      sourceType: 'compound_governor_bravo',
      chainId: '0x7a69',
      contractAddress,
    });

    app = await NestFactory.createApplicationContext(G1DerivationTestModule, {
      abortOnError: false,
    });
    await app.init();
    client = app.get(ChainContextRegistry).peek('0x7a69')!.client as typeof client;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await truncateAllTestTables(pgDb);
  });

  beforeEach(async () => {
    await truncateAllIngestionTables(pgDb);
    await sql`TRUNCATE proposal, actor RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE event_archive_compound_governor_bravo DELETE WHERE chain_id = '0x7a69'`.execute(
      chDb,
    );
  });

  it('SPEC §3.4 #5 — re-running G1 derivation produces same final state (G1 acceptance)', async () => {
    const derivationWorker = app.get(DerivationWorkerService);

    const createdReceipt = await sendAndWait(client, {
      from: accounts[0]!,
      to: contractAddress,
      data: '0x' + EMIT_VALID_SELECTOR,
    });

    await pollUntil(async () => {
      const row = await pgDb
        .selectFrom('archive_confirmation')
        .select(['id'])
        .where('chain_id', '=', '0x7a69')
        .where('tx_hash', '=', createdReceipt.transactionHash.toLowerCase())
        .executeTakeFirst();
      return row !== undefined;
    }, 20_000);

    await pgDb
      .updateTable('archive_confirmation')
      .set({ confirmation_status: 'confirmed', confirmed_at: new Date() })
      .where('chain_id', '=', '0x7a69')
      .where('tx_hash', '=', createdReceipt.transactionHash.toLowerCase())
      .execute();

    await pollUntil(async () => {
      await derivationWorker.tick();
      const snapshot = await readProposalSnapshot();
      return (
        snapshot.proposals.length === 1 &&
        snapshot.actions.length === 1 &&
        snapshot.choices.length === 3
      );
    }, 20_000);

    const createdSnapshot = await readProposalSnapshot();
    const proposal = createdSnapshot.proposals[0]!;
    expect(proposal.source_type).toBe('compound_governor_bravo');
    expect(proposal.source_id).toBe('1');
    expect(proposal.voting_power_block).toBe('100');
    expect(proposal.voting_starts_block).toBe('100');
    expect(proposal.voting_ends_block).toBe('200');
    expect(proposal.state).toBe('pending');
    expect(createdSnapshot.actions).toEqual([
      expect.objectContaining({
        action_index: 0,
        target_address: '0x0000000000000000000000000000000000000002',
        target_chain_id: '0x7a69',
        value_wei: '0',
        function_signature: '',
        calldata: '0x',
      }),
    ]);
    expect(createdSnapshot.choices).toEqual([
      expect.objectContaining({ choice_index: 0, value: 'Against' }),
      expect.objectContaining({ choice_index: 1, value: 'For' }),
      expect.objectContaining({ choice_index: 2, value: 'Abstain' }),
    ]);

    // Idempotency: reset derived_at and re-run — same snapshot
    await pgDb
      .updateTable('archive_confirmation')
      .set({ derived_at: null })
      .where('tx_hash', '=', createdReceipt.transactionHash.toLowerCase())
      .execute();
    await derivationWorker.tick();

    const replaySnapshot = await readProposalSnapshot();
    expect(replaySnapshot.proposals).toHaveLength(1);
    expect(replaySnapshot.proposals[0]!.id).toBe(proposal.id);
    expect(replaySnapshot.actions).toHaveLength(1);
    expect(replaySnapshot.choices).toHaveLength(3);

    await insertConfirmedCompoundArchiveEvent({
      eventType: 'ProposalExecuted',
      blockNumber: 9_000_001n,
      txHash: numberedHash(1),
      blockHash: numberedHash(101),
      payload: { proposalId: '1' },
    });
    await derivationWorker.tick();

    const executed = await pgDb.selectFrom('proposal').selectAll().executeTakeFirst();
    expect(executed).toBeDefined();
    expect(executed!.state).toBe('executed');

    await insertConfirmedCompoundArchiveEvent({
      eventType: 'ProposalQueued',
      blockNumber: 9_000_002n,
      txHash: numberedHash(2),
      blockHash: numberedHash(102),
      payload: { proposalId: '1', eta: '123' },
    });
    await derivationWorker.tick();

    const afterLateQueued = await readProposalSnapshot();
    expect(afterLateQueued.proposals).toHaveLength(1);
    expect(afterLateQueued.proposals[0]!.id).toBe(proposal.id);
    expect(afterLateQueued.proposals[0]!.state).toBe('executed');
    expect(afterLateQueued.actions).toHaveLength(1);
    expect(afterLateQueued.choices).toHaveLength(3);
  }, 60_000);

  async function insertConfirmedCompoundArchiveEvent(opts: {
    eventType: 'ProposalQueued' | 'ProposalExecuted' | 'ProposalCanceled';
    blockNumber: bigint;
    txHash: string;
    blockHash: string;
    payload: Record<string, string>;
  }): Promise<void> {
    await chDb
      .insertInto('event_archive_compound_governor_bravo')
      .values({
        dao_source_id: daoSourceId,
        chain_id: '0x7a69',
        block_number: opts.blockNumber.toString(),
        block_hash: opts.blockHash,
        tx_hash: opts.txHash,
        log_index: 0,
        event_type: opts.eventType,
        payload: JSON.stringify(opts.payload),
      })
      .execute();

    await pgDb
      .insertInto('archive_confirmation')
      .values({
        source_type: 'compound_governor_bravo',
        dao_source_id: daoSourceId,
        chain_id: '0x7a69',
        block_number: opts.blockNumber.toString(),
        block_hash: opts.blockHash,
        tx_hash: opts.txHash,
        log_index: 0,
        event_type: opts.eventType,
        received_at: new Date(),
        confirmation_status: 'confirmed',
        confirmed_at: new Date(),
        orphaned_at: null,
        orphaned_by_reorg_event_id: null,
        derived_at: null,
      })
      .execute();
  }
});

async function readProposalSnapshot() {
  const proposals = await pgDb.selectFrom('proposal').selectAll().orderBy('id', 'asc').execute();
  const actions = await pgDb
    .selectFrom('proposal_action')
    .selectAll()
    .orderBy('action_index', 'asc')
    .execute();
  const choices = await pgDb
    .selectFrom('proposal_choice')
    .selectAll()
    .orderBy('choice_index', 'asc')
    .execute();
  return { proposals, actions, choices };
}

function numberedHash(value: number): string {
  return '0x' + value.toString(16).padStart(64, '0');
}
