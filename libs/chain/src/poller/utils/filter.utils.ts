import type { LogFilter } from '../types.js';

/** Returns a new `LogFilter` with every address and topic lowercased.
 *  Does not mutate the input. */
export function lowercaseFilter(filter: LogFilter): LogFilter {
  const address = Array.isArray(filter.address)
    ? filter.address.map((a) => a.toLowerCase())
    : filter.address.toLowerCase();
  const topics = filter.topics?.map((t) => {
    if (t === null) return null;
    if (Array.isArray(t)) return t.map((s) => s.toLowerCase());
    return t.toLowerCase();
  });
  return { address, topics };
}
