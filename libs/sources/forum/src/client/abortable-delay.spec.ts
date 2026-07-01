import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortableDelay } from './abortable-delay';

afterEach(() => {
  vi.useRealTimers();
});

describe('abortableDelay', () => {
  it('resolves after the timeout elapses', async () => {
    vi.useFakeTimers();
    const p = abortableDelay(1000, new AbortController().signal);
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects immediately if the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already'));
    await expect(abortableDelay(1000, controller.signal)).rejects.toThrow('already');
  });

  it('rejects with the abort reason if aborted mid-wait', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const p = abortableDelay(10_000, controller.signal);
    controller.abort(new Error('tick-timeout'));
    await expect(p).rejects.toThrow('tick-timeout');
  });

  it('rejects with a generic error when aborted without an Error reason', async () => {
    const controller = new AbortController();
    controller.abort('stringy-reason');
    await expect(abortableDelay(1000, controller.signal)).rejects.toThrow('aborted');
  });

  it('rejects generically when aborted mid-wait without an Error reason', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const p = abortableDelay(10_000, controller.signal);
    controller.abort('stringy-reason');
    await expect(p).rejects.toThrow('aborted');
  });
});
