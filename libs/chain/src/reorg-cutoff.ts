import type { ChainConfig } from './config/config.js';

export function reorgCutoff(headBlock: bigint, config: ChainConfig): bigint {
  return headBlock - BigInt(config.reorgHorizon) * 2n;
}
