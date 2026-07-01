import { describe, expect, it } from 'vitest';
import { RatePacer, type RatePacerOptions } from './rate-pacer';

const signal = (): AbortSignal => new AbortController().signal;

/** A RatePacer driven by virtual time: `sleep` advances the clock, so waits are deterministic. */
function harness(opts: Omit<RatePacerOptions, 'now' | 'sleep'>) {
  let t = 0;
  const sleeps: number[] = [];
  const pacer = new RatePacer({
    ...opts,
    now: () => t,
    sleep: (ms: number) => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
  });
  return { pacer, sleeps, now: () => t };
}

describe('RatePacer', () => {
  it('grants immediately while under both windows', async () => {
    const { pacer, sleeps } = harness({ maxPerShortWindow: 5, maxPerLongWindow: 100 });
    for (let i = 0; i < 5; i += 1) await pacer.acquire(signal());
    expect(sleeps).toEqual([]);
  });

  it('waits for the short window to free a slot once saturated', async () => {
    const { pacer, sleeps, now } = harness({
      maxPerShortWindow: 3,
      shortWindowMs: 10,
      maxPerLongWindow: 100,
    });
    for (let i = 0; i < 3; i += 1) await pacer.acquire(signal());
    await pacer.acquire(signal()); // 4th must wait for the oldest of the 3 to exit the 10ms window
    expect(sleeps).toEqual([10]);
    expect(now()).toBe(10);
  });

  it('waits for the long window when it is the binding limit', async () => {
    const { pacer, sleeps } = harness({
      maxPerShortWindow: 1000,
      maxPerLongWindow: 2,
      longWindowMs: 60,
    });
    await pacer.acquire(signal());
    await pacer.acquire(signal());
    await pacer.acquire(signal()); // 3rd waits ~60ms for the long window
    expect(sleeps).toEqual([60]);
  });

  it('spaces sequential grants across windows (2 per 10ms)', async () => {
    const { pacer, now } = harness({
      maxPerShortWindow: 2,
      shortWindowMs: 10,
      maxPerLongWindow: 100,
    });
    const times: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      await pacer.acquire(signal());
      times.push(now());
    }
    expect(times).toEqual([0, 0, 10, 10, 20]);
  });

  it('serialises concurrent acquisitions so the window is never exceeded', async () => {
    let t = 0;
    const pacer = new RatePacer({
      maxPerShortWindow: 2,
      shortWindowMs: 10,
      maxPerLongWindow: 100,
      now: () => t,
      sleep: (ms) => {
        t += ms;
        return Promise.resolve();
      },
    });

    // Fire 5 at once. If serialisation held, exactly two grants fit per 10ms window, so the last
    // grant lands at t=20; a broken pacer would let all five through at t=0.
    await Promise.all(Array.from({ length: 5 }, () => pacer.acquire(signal())));
    expect(t).toBe(20);
  });
});
