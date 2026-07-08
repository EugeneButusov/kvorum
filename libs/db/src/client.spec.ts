import { describe, it, expect, vi } from 'vitest';
import { pgPool } from './client';

describe('pgPool idle-client error guard', () => {
  it('registers an error listener (an un-listened pg pool error crashes the process)', () => {
    expect(pgPool.listenerCount('error')).toBeGreaterThanOrEqual(1);
  });

  it('logs and swallows an idle-client error event instead of rethrowing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // With no 'error' listener, EventEmitter throws; the guard must prevent that.
    expect(() =>
      pgPool.emit('error', new Error('connection terminated unexpectedly')),
    ).not.toThrow();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[pg-pool]'),
      'connection terminated unexpectedly',
    );
    spy.mockRestore();
  });
});
