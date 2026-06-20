import type { ArchiveEventType, JsonValue } from '@libs/domain';
import type { SourceContext } from '../source-context';

export interface PollItem {
  /** Source-native id — Snapshot proposal hash, Discourse topic id, etc. */
  externalId: string;
  /** Classified off-chain event type (no ABI decode downstream); drives derivation dispatch. */
  eventType: ArchiveEventType;
  /** Hash over this item's raw poll-response slice (see ADR-071 contentHash constraint). */
  contentHash: string;
  /** Source-native ordinal (bigint as string) giving a deterministic derivation order.
   *  A source supplies an ordinal for ALL items or NONE; it must parse as bigint. */
  ordinal: string | null;
  /** Raw API slice for this item — opaque to the transport layer. */
  payload: unknown;
}

export interface PollResult<TCursor extends JsonValue = JsonValue> {
  items: readonly PollItem[];
  nextCursor: TCursor | null;
}

export interface PollPollContext {
  readonly source: SourceContext;
  /** Aborted on per-tick deadline; MUST be threaded into the HTTP client by poll(). */
  readonly signal: AbortSignal;
}

export interface PollListener<TCursor extends JsonValue = JsonValue> {
  readonly intervalMs: number;
  /** MUST thread ctx.signal into its HTTP client so the per-tick deadline can cancel it. */
  poll(ctx: PollPollContext, cursor: TCursor | null): Promise<PollResult<TCursor>>;
}

/** App-level seam between the domain-blind poll driver and the off-chain queue.
 *  `commitTick` atomically enqueues the tick's items AND advances the persisted cursor
 *  in one transaction (all-or-nothing); `loadCursor` resumes on start. The cursor advances
 *  only if the jobs are durably enqueued, so a crash re-fetches (idempotent at the consumer)
 *  rather than skips. See ADR-071 §off-chain consumer. */
export interface QueueProducerPort {
  loadCursor(source: SourceContext): Promise<JsonValue | null>;
  commitTick(
    source: SourceContext,
    items: readonly PollItem[],
    nextCursor: JsonValue | null,
  ): Promise<void>;
}
