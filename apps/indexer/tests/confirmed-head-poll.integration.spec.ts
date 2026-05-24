/**
 * Integration test: EventPoller confirmed-head boundary.
 *
 * Verifies that readConfirmedHead() correctly computes tip − headLag and that the
 * EventPoller does not surface logs from blocks above the confirmed boundary.
 * Requires ANVIL_RPC_URL to be set; skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EventPoller,
  FailoverRpcClient,
  readConfirmedHead,
  type ChainConfig,
  type LogEvent,
} from '@libs/chain';
import {
  COMPOUND_EMITTER_DEPLOY_BYTECODE,
  EMIT_VALID_SELECTOR,
  PROPOSAL_CREATED_TOPIC,
} from './_fixtures/compound-emitter.bytecode';

const ANVIL_URL = process.env['ANVIL_RPC_URL'];
const describeIf = ANVIL_URL ? describe : describe.skip;

const HEAD_LAG = 5;

const CHAIN_CFG: ChainConfig = {
  chainId: '0x7a69',
  name: 'anvil',
  headLag: HEAD_LAG,
  providers: [{ name: 'anvil', url: ANVIL_URL!, kind: 'http', priority: 1, timeoutMs: 4_000 }],
};

async function mineBlocks(client: FailoverRpcClient, count: number): Promise<void> {
  await client.send('anvil_mine', ['0x' + count.toString(16)]);
}

async function sendAndMine(
  client: FailoverRpcClient,
  tx: { from: string; to?: string; data: string },
): Promise<{ blockNumber: bigint; contractAddress: string | null }> {
  const txHash = await client.send<string>('eth_sendTransaction', [tx]);
  let receipt: { blockNumber: string; contractAddress: string | null } | null = null;
  const deadline = Date.now() + 10_000;
  while (!receipt && Date.now() < deadline) {
    receipt = await client.send<typeof receipt>('eth_getTransactionReceipt', [txHash]);
    if (!receipt) await new Promise<void>((r) => setTimeout(r, 50));
  }
  if (!receipt) throw new Error('receipt not found');
  return { blockNumber: BigInt(receipt.blockNumber), contractAddress: receipt.contractAddress };
}

describeIf('confirmed-head poll boundary (anvil)', () => {
  let client: FailoverRpcClient;

  beforeAll(async () => {
    client = new FailoverRpcClient(CHAIN_CFG);
    await client.start();
    // Ensure the chain has enough blocks that headLag < tip before the tests run
    const tipHex = await client.send<string>('eth_blockNumber', []);
    const tip = BigInt(tipHex);
    if (tip <= BigInt(HEAD_LAG)) {
      await mineBlocks(client, HEAD_LAG - Number(tip) + 2);
    }
  });

  afterAll(async () => {
    await client?.stop();
  });

  it('readConfirmedHead returns 0n when lag exceeds tip', async () => {
    const tipHex = await client.send<string>('eth_blockNumber', []);
    const tip = BigInt(tipHex);
    const oversizedLagCfg: ChainConfig = { ...CHAIN_CFG, headLag: Number(tip) + 100 };
    const confirmed = await readConfirmedHead(client, oversizedLagCfg);
    expect(confirmed).toBe(0n);
  });

  it('readConfirmedHead returns tip - headLag when tip > headLag', async () => {
    const tipHex = await client.send<string>('eth_blockNumber', []);
    const tip = BigInt(tipHex);
    expect(tip).toBeGreaterThan(BigInt(HEAD_LAG));
    const confirmed = await readConfirmedHead(client, CHAIN_CFG);
    expect(confirmed).toBe(tip - BigInt(HEAD_LAG));
  });

  it('readConfirmedHead advances with the chain', async () => {
    const before = await readConfirmedHead(client, CHAIN_CFG);
    await mineBlocks(client, 3);
    const after = await readConfirmedHead(client, CHAIN_CFG);
    expect(after).toBe(before + 3n);
  });

  it('EventPoller does not surface logs from blocks above confirmedHead', async () => {
    // Mine to a known state
    await mineBlocks(client, HEAD_LAG);
    const accounts = await client.send<string[]>('eth_accounts', []);

    // Deploy the compound emitter contract
    const deploy = await sendAndMine(client, {
      from: accounts[0]!,
      data: COMPOUND_EMITTER_DEPLOY_BYTECODE,
    });
    const contractAddr = deploy.contractAddress!.toLowerCase();

    // Emit an event — this lands in the current tip block
    const emitTx = await sendAndMine(client, {
      from: accounts[0]!,
      to: contractAddr,
      data: '0x' + EMIT_VALID_SELECTOR,
    });
    const emitBlock = emitTx.blockNumber;

    // Verify the emitted block is above the current confirmed head (not yet confirmed)
    const tipHex = await client.send<string>('eth_blockNumber', []);
    const tip = BigInt(tipHex);
    const confirmedHead = tip - BigInt(HEAD_LAG);
    expect(emitBlock).toBeGreaterThan(confirmedHead);

    // Run the EventPoller — the event should NOT be surfaced yet
    const surfacedBefore: LogEvent[] = [];
    const pollerBefore = new EventPoller({
      rpcClient: client,
      chainId: '0x7a69',
      chainName: 'anvil',
      headLag: HEAD_LAG,
      filter: { address: contractAddr, topics: [PROPOSAL_CREATED_TOPIC] },
      sourceType: 'compound_governor',
      daoSourceLabel: 'confirmed-head-test-before',
      pollIntervalMs: 150,
      stopTimeoutMs: 2_000,
    });
    pollerBefore.onEvents((evs) => surfacedBefore.push(...evs));
    await pollerBefore.start();
    await new Promise<void>((r) => setTimeout(r, 400));
    await pollerBefore.stop();

    expect(surfacedBefore).toHaveLength(0);

    // Mine headLag + 1 more blocks to bring emitBlock into the confirmed zone
    await mineBlocks(client, HEAD_LAG + 1);

    // Re-run the EventPoller — the event should now appear
    const surfacedAfter: LogEvent[] = [];
    const pollerAfter = new EventPoller({
      rpcClient: client,
      chainId: '0x7a69',
      chainName: 'anvil',
      headLag: HEAD_LAG,
      filter: { address: contractAddr, topics: [PROPOSAL_CREATED_TOPIC] },
      sourceType: 'compound_governor',
      daoSourceLabel: 'confirmed-head-test-after',
      pollIntervalMs: 150,
      stopTimeoutMs: 2_000,
    });
    pollerAfter.onEvents((evs) => surfacedAfter.push(...evs));
    await pollerAfter.start();
    await new Promise<void>((r) => setTimeout(r, 400));
    await pollerAfter.stop();

    expect(surfacedAfter.length).toBeGreaterThan(0);
    expect(surfacedAfter[0]!.blockNumber).toBe(emitBlock);
  }, 30_000);
});
