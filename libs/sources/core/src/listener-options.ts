export interface IngesterListenerOptions<TEvent = unknown> {
  onWriteFailure?: 'swallow' | 'throw';
  /**
   * Optional post-decode predicate. When provided and it returns false for a decoded event, the
   * event is skipped silently (no archive write, no DLQ). Used by sources that subscribe to a
   * shared contract whose events carry an un-indexed scope (e.g. Split Delegation's `context`) and
   * must drop out-of-scope events that topic filters cannot exclude.
   */
  filter?: (decoded: TEvent) => boolean;
}
