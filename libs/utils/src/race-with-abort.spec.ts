import { describe, expect, it } from 'vitest';
import { AbortError, raceWithAbort } from './race-with-abort.js';

describe('raceWithAbort', () => {
  it('throws when signal already aborted', async () => {
    const c = new AbortController();
    c.abort();
    await expect(raceWithAbort(Promise.resolve(1), c.signal)).rejects.toBeInstanceOf(AbortError);
  });

  it('resolves when promise resolves first', async () => {
    const c = new AbortController();
    await expect(raceWithAbort(Promise.resolve(42), c.signal)).resolves.toBe(42);
  });

  it('rejects with AbortError when aborted before promise resolves', async () => {
    const c = new AbortController();
    const p = new Promise<number>((resolve) => setTimeout(() => resolve(1), 50));
    const raced = raceWithAbort(p, c.signal);
    c.abort();
    await expect(raced).rejects.toBeInstanceOf(AbortError);
  });
});
