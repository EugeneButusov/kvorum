import type { LogFilter, EventsListener, LogEvent } from '@libs/chain';
import type { SourceType } from '@libs/db';

/** Nest injection token for the multi-provider array of registered SourcePlugins.
 *  Source modules provide with `multi: true`; the orchestrator injects the assembled array. */
export const SOURCE_PLUGINS = 'SOURCE_PLUGINS';

export interface SourcePlugin<TConfig = unknown> {
  /** Discriminant matched against `dao_source.source_type`. */
  readonly sourceType: SourceType;

  /** Validates `dao_source.source_config`; throws on malformed input. */
  parseConfig(raw: unknown): TConfig;

  /** Chain-family-tagged ingest descriptor: how to fetch AND how to handle each fetched event. */
  buildIngestSpec(ctx: SourceContext, cfg: TConfig): IngestSpec;
}

/** Each variant pairs a fetch strategy with its event shape.
 *  The discriminant lets the orchestrator dispatch to the right FetchDriver without
 *  coupling source-specific logic to orchestration. */
export type IngestSpec = {
  kind: 'evm-event-poller';
  filter: LogFilter;
  listener: EventsListener<LogEvent>;
};
// future: | { kind: 'solana-program-logs'; programId: string; listener: EventsListener<SolanaLog>; }

export interface SourceContext {
  daoSourceId: string;
  sourceType: SourceType;
  chainId: number;
  /** Low-cardinality metric/log label — MUST equal `sourceType`. Never set to `daoSourceId`
   *  (UUIDs would blow up label cardinality on archive_* / batch_duration_seconds metrics). */
  sourceLabel: SourceType;
}
