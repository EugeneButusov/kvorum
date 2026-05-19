export { SOURCE_PLUGINS } from '@sources/core';
export const FETCH_DRIVERS = 'FETCH_DRIVERS';
export const CHAIN_HEAD_LISTENERS = 'CHAIN_HEAD_LISTENERS';

import type { ChainContext } from '@libs/chain';
export interface ChainHeadListener {
  onChainReady(ctx: ChainContext): void;
}
