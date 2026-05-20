import type { ChainConfig } from '@libs/chain';
import type { IngestSpec, SourceContext } from '@sources/core';

export interface FetchDriverHandle {
  stop(): Promise<void>;
}

export interface FetchDriver<K extends IngestSpec['kind'] = IngestSpec['kind']> {
  readonly kind: K;
  start(
    spec: Extract<IngestSpec, { kind: K }>,
    ctx: SourceContext,
    chainCfg: ChainConfig,
    opts?: {
      onFirstHeadComplete?: (head: bigint) => void;
    },
  ): Promise<FetchDriverHandle>;
}
