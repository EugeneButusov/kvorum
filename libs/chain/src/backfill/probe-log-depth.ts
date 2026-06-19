import { isTooManyResults } from './range-fetcher.js';
import type { RpcClient } from '../client/rpc-client.js';

export interface LogDepthProbeInput {
  rpcClient: RpcClient;
  /** Contract address of the source being probed (lowercased internally). */
  address: string;
  /** Earliest block the backfill will request — usually the source's active_from_block. */
  fromBlock: bigint;
  /** Block window for the probe getLogs. Default 2000. */
  window?: number;
}

export type LogDepthProbeResult = { ok: true } | { ok: false; reason: string };

const DEFAULT_PROBE_WINDOW = 2000;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Verifies a provider can serve historical logs at `fromBlock` before a backfill starts.
 *
 * `eth_getBlockByNumber` is a liveness check only — pruned, non-archive nodes still answer it,
 * so it cannot prove log depth. The bounded `eth_getLogs` is the actual archive-depth signal: a
 * provider missing history that deep rejects the range request. A "too many results" error means
 * the provider DOES serve the range (the window is just over-large), so it counts as a pass — the
 * real backfill's adaptive chunk-shrink handles oversized windows.
 */
export async function probeLogDepth(input: LogDepthProbeInput): Promise<LogDepthProbeResult> {
  const window = input.window ?? DEFAULT_PROBE_WINDOW;
  const fromHex = `0x${input.fromBlock.toString(16)}`;

  try {
    const block = await input.rpcClient.send<unknown>('eth_getBlockByNumber', [fromHex, false]);
    if (block == null) {
      return {
        ok: false,
        reason: `eth_getBlockByNumber returned null for block ${input.fromBlock}`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: `eth_getBlockByNumber failed at block ${input.fromBlock}: ${errMessage(err)}`,
    };
  }

  const toBlock = input.fromBlock + BigInt(window);
  try {
    await input.rpcClient.send<unknown[]>('eth_getLogs', [
      {
        fromBlock: fromHex,
        toBlock: `0x${toBlock.toString(16)}`,
        address: input.address.toLowerCase(),
      },
    ]);
    return { ok: true };
  } catch (err) {
    if (isTooManyResults(err)) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `eth_getLogs failed over [${input.fromBlock}, ${toBlock}]: ${errMessage(err)}`,
    };
  }
}
