import type { ChainConfig } from '@libs/chain';
import type { IngestSpec, SourceContext } from '@sources/core';

export interface FetchDriverHandle {
  stop(): Promise<void>;
}

/** Per-kind conditional: EVM arms require chainCfg; the poll arm omits it entirely.
 *  This prevents TS from silently accepting a missing chainCfg on EVM drivers. */
export type FetchDriver<K extends IngestSpec['kind'] = IngestSpec['kind']> = K extends 'poll'
  ? {
      readonly kind: K;
      start(spec: Extract<IngestSpec, { kind: K }>, ctx: SourceContext): Promise<FetchDriverHandle>;
    }
  : {
      readonly kind: K;
      start(
        spec: Extract<IngestSpec, { kind: K }>,
        ctx: SourceContext,
        chainCfg: ChainConfig,
        opts?: {
          onFirstHeadComplete?: (head: bigint) => void;
        },
      ): Promise<FetchDriverHandle>;
    };
