import type { RpcClient } from './client/rpc-client.js';
import { chainMetrics } from './metrics/metrics.js';

type ConfirmedHeadConfig = {
  name: string;
  headLag?: number;
  reorgHorizon?: number;
};

/** Returns the highest block at or below tip-headLag. */
export async function readConfirmedHead(
  rpcClient: RpcClient,
  chainConfig: ConfirmedHeadConfig,
  daoSourceLabel?: string,
): Promise<bigint> {
  const headHex = await rpcClient.send<string>('eth_blockNumber', []);
  const tip = BigInt(headHex);
  const lag = BigInt(chainConfig.headLag ?? chainConfig.reorgHorizon ?? 0);
  const confirmed = tip > lag ? tip - lag : 0n;
  chainMetrics.headLagApplied.record(Number(lag), {
    chain: chainConfig.name,
    dao_source: daoSourceLabel ?? 'unset',
  });
  return confirmed;
}
