import type { ChainContext } from '@libs/chain';

const MAX_CACHE_ENTRIES = 10_000;

export class VoteBlockTimestampFetcher {
  private readonly cache = new Map<string, Date>();

  async fetchBatch(
    chainCtx: Pick<ChainContext, 'client' | 'chainCfg'>,
    blockNumbers: readonly string[],
  ): Promise<Map<string, Date>> {
    const result = new Map<string, Date>();
    const misses = [...new Set(blockNumbers)].filter((blockNumber) => {
      const cached = this.cache.get(this.cacheKey(chainCtx.chainCfg.chainId, blockNumber));
      if (cached !== undefined) {
        result.set(blockNumber, cached);
        return false;
      }
      return true;
    });

    const resolved = await Promise.all(
      misses.map(async (blockNumber) => {
        const raw = await chainCtx.client.send<{ timestamp?: string }>('eth_getBlockByNumber', [
          `0x${BigInt(blockNumber).toString(16)}`,
          false,
        ]);
        const ts = raw?.timestamp;
        if (ts === undefined) return undefined;
        const parsed = new Date(Number(BigInt(ts)) * 1000);
        return { blockNumber, parsed };
      }),
    );

    for (const item of resolved) {
      if (item === undefined) continue;
      const key = this.cacheKey(chainCtx.chainCfg.chainId, item.blockNumber);
      this.cacheSet(key, item.parsed);
      result.set(item.blockNumber, item.parsed);
    }

    return result;
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

  private cacheKey(chainId: string, blockNumber: string): string {
    return `${chainId}:${blockNumber}`;
  }
}
