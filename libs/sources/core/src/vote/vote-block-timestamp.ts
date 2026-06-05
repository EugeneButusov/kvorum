import type { ChainContext } from '@libs/chain';

const MAX_CACHE_ENTRIES = 10_000;

export interface VoteBlockRef {
  blockNumber: string;
  blockHash: string;
}

export class VoteBlockTimestampFetcher {
  private readonly cache = new Map<string, Date>();

  async fetchBatch(
    chainCtx: Pick<ChainContext, 'client' | 'chainCfg'>,
    blocks: readonly VoteBlockRef[],
  ): Promise<Map<string, Date>> {
    const result = new Map<string, Date>();
    const uniqueBlocks = [
      ...new Map(blocks.map((block) => [block.blockHash.toLowerCase(), block])).values(),
    ];
    const misses = uniqueBlocks.filter((block) => {
      const key = this.cacheKey(chainCtx.chainCfg.chainId, block.blockHash);
      const cached = this.cache.get(key);
      if (cached !== undefined) {
        result.set(this.resultKey(block.blockNumber, block.blockHash), cached);
        return false;
      }
      return true;
    });

    const resolved = await Promise.all(
      misses.map(async (block) => {
        const raw = await chainCtx.client.send<{
          hash?: string;
          number?: string;
          timestamp?: string;
        }>('eth_getBlockByHash', [block.blockHash, false]);
        if (raw?.timestamp === undefined || raw.hash === undefined || raw.number === undefined) {
          return undefined;
        }
        if (raw.hash.toLowerCase() !== block.blockHash.toLowerCase()) {
          return undefined;
        }
        if (BigInt(raw.number) !== BigInt(block.blockNumber)) {
          return undefined;
        }
        const parsed = new Date(Number(BigInt(raw.timestamp)) * 1000);
        return { block, parsed };
      }),
    );

    for (const item of resolved) {
      if (item === undefined) continue;
      const key = this.cacheKey(chainCtx.chainCfg.chainId, item.block.blockHash);
      this.cacheSet(key, item.parsed);
      result.set(this.resultKey(item.block.blockNumber, item.block.blockHash), item.parsed);
    }

    return result;
  }

  resultKey(blockNumber: string, blockHash: string): string {
    return `${blockNumber}:${blockHash.toLowerCase()}`;
  }

  private cacheSet(key: string, value: Date): void {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size <= MAX_CACHE_ENTRIES) return;
    const oldestKey = this.cache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
    }
  }

  private cacheKey(chainId: string, blockHash: string): string {
    return `${chainId}:${blockHash.toLowerCase()}`;
  }
}
