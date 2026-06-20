import type { SourceContext } from '../source-context';

export interface PollItem {
  /** Source-native id — Snapshot proposal hash, Discourse topic id, etc. */
  externalId: string;
  /** Hash over this item's raw poll-response slice (see ADR-071 contentHash constraint). */
  contentHash: string;
  /** Raw API slice for this item — opaque to the transport layer. */
  payload: unknown;
}

export interface PollResult<TCursor> {
  items: readonly PollItem[];
  nextCursor: TCursor | null;
}

export interface PollPollContext {
  readonly source: SourceContext;
  /** Aborted on per-tick deadline; MUST be threaded into the HTTP client by poll(). */
  readonly signal: AbortSignal;
}

export interface PollListener<TCursor = unknown> {
  readonly intervalMs: number;
  /** MUST thread ctx.signal into its HTTP client so the per-tick deadline can cancel it. */
  poll(ctx: PollPollContext, cursor: TCursor | null): Promise<PollResult<TCursor>>;
}

/** App-level seam between the domain-blind poll driver and the off-chain consumer. */
export interface PollEnqueuePort {
  enqueue(source: SourceContext, item: PollItem): Promise<void>;
}
