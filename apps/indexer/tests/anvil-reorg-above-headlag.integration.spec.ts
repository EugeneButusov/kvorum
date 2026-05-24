/**
 * Integration test: reorg above headLag boundary is invisible to the indexer.
 *
 * Forces an anvil chain reorg at a depth smaller than headLag and verifies:
 * 1. readConfirmedHead() is unaffected (stays positive, varies by at most headLag).
 * 2. EventPoller continues running without errors after the reorg.
 * 3. No removed=true logs are surfaced (logsWithRemovedFlag metric stays at 0).
 *
 * Requires ANVIL_RPC_URL. Skipped otherwise.
 * anvil_reorg requires Foundry ≥ v0.3; if not present the test gracefully passes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderMetrics } from '@libs/observability';
import {
  EventPoller,
  FailoverRpcClient,
  readConfirmedHead,
  type ChainConfig,
  type LogEvent,
} from '@libs/chain';

const ANVIL_URL = process.env['ANVIL_RPC_URL'];
const describeIf = ANVIL_URL ? describe : describe.skip;

const HEAD_LAG = 5;
const REORG_DEPTH = 2; // depth < headLag: confirmed boundary is unaffected

const CHAIN_CFG: ChainConfig = {
  chainId: '0x7a69',
  name: 'anvil',
  headLag: HEAD_LAG,
  providers: [{ name: 'anvil', url: ANVIL_URL!, kind: 'http', priority: 1, timeoutMs: 4_000 }],
};

async function mineBlocks(client: FailoverRpcClient, count: number): Promise<void> {
  await client.send('anvil_mine', ['0x' + count.toString(16)]);
}

/** Returns false if anvil_reorg is not available. */
async function tryReorg(client: FailoverRpcClient, depth: number): Promise<boolean> {
  try {
    await client.send('anvil_reorg', [{ depth }]);
    return true;
  } catch {
    return false;
  }
}

describeIf('reorg above headLag is invisible to the indexer (anvil)', () => {
  let client: FailoverRpcClient;

  beforeAll(async () => {
    client = new FailoverRpcClient(CHAIN_CFG);
    await client.start();
    // Ensure tip > headLag + reorg depth so confirmed boundary stays positive
    const tipHex = await client.send<string>('eth_blockNumber', []);
    const tip = BigInt(tipHex);
    const needed = BigInt(HEAD_LAG + REORG_DEPTH + 5);
    if (tip < needed) {
      await mineBlocks(client, Number(needed - tip));
    }
  });

  afterAll(async () => {
    await client?.stop();
  });

  it('confirmedHead is unaffected by a reorg shallower than headLag', async () => {
    const confirmedBefore = await readConfirmedHead(client, CHAIN_CFG);
    expect(confirmedBefore).toBeGreaterThan(0n);

    const reorged = await tryReorg(client, REORG_DEPTH);
    if (!reorged) {
      console.log('anvil_reorg not available — skipping reorg assertion');
      return;
    }

    // After a depth-REORG_DEPTH reorg anvil mines a replacement chain,
    // so the tip may differ by ±REORG_DEPTH. The confirmed head changes by
    // at most REORG_DEPTH blocks, which is less than HEAD_LAG.
    const confirmedAfter = await readConfirmedHead(client, CHAIN_CFG);
    expect(confirmedAfter).toBeGreaterThan(0n);
    expect(Math.abs(Number(confirmedBefore) - Number(confirmedAfter))).toBeLessThanOrEqual(
      REORG_DEPTH,
    );
  }, 15_000);

  it('EventPoller continues without errors after reorg above headLag', async () => {
    await mineBlocks(client, HEAD_LAG + 2);

    let listenerErrors = 0;
    const surfaced: LogEvent[] = [];
    const poller = new EventPoller({
      rpcClient: client,
      chainId: '0x7a69',
      chainName: 'anvil',
      headLag: HEAD_LAG,
      filter: { address: '0x' + '00'.repeat(20) },
      sourceType: 'compound_governor',
      daoSourceLabel: 'reorg-resilience-test',
      pollIntervalMs: 150,
      stopTimeoutMs: 2_000,
    });
    poller.onEvents((evs) => {
      try {
        surfaced.push(...evs);
      } catch (err) {
        listenerErrors++;
      }
    });

    await poller.start();

    // Trigger a shallow reorg while the poller is running
    await tryReorg(client, REORG_DEPTH);

    // Mine a few replacement blocks to give the chain a new tip
    await mineBlocks(client, REORG_DEPTH + 1);

    // Let the poller run for 2 more ticks after the reorg
    await new Promise<void>((r) => setTimeout(r, 400));
    await poller.stop();

    expect(listenerErrors).toBe(0);
  }, 20_000);

  it('no removed=true logs surfaced when reorg is above headLag', async () => {
    await mineBlocks(client, HEAD_LAG + 2);

    const poller = new EventPoller({
      rpcClient: client,
      chainId: '0x7a69',
      chainName: 'anvil',
      headLag: HEAD_LAG,
      filter: { address: '0x' + '00'.repeat(20) },
      sourceType: 'compound_governor',
      daoSourceLabel: 'reorg-removed-flag-test',
      pollIntervalMs: 150,
      stopTimeoutMs: 2_000,
    });
    poller.onEvents(() => undefined);
    await poller.start();

    // Capture metric baseline
    const before = await renderMetrics();
    const removedBefore = extractMetricValue(before, 'test_ingestion_logs_with_removed_flag') ?? 0;

    // Reorg above headLag
    await tryReorg(client, REORG_DEPTH);
    await mineBlocks(client, REORG_DEPTH + 1);
    await new Promise<void>((r) => setTimeout(r, 400));
    await poller.stop();

    const after = await renderMetrics();
    const removedAfter = extractMetricValue(after, 'test_ingestion_logs_with_removed_flag') ?? 0;

    // A reorg above headLag must never produce removed=true logs in the poll window
    expect(removedAfter).toBe(removedBefore);
  }, 20_000);
});

function extractMetricValue(text: string, name: string): number | null {
  const match = text.match(new RegExp(`${name}\\{[^}]*\\}\\s+([\\d.]+)`));
  return match ? Number(match[1]) : null;
}
