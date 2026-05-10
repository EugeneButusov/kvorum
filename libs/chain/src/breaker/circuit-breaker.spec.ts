import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

function makeClock(startMs = 0) {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const opts = { failureThreshold: 5, windowMs: 60_000, cooldownMs: 30_000 };

describe('CircuitBreaker', () => {
  it('starts closed and grants requests', () => {
    const cb = new CircuitBreaker(opts);
    expect(cb.getState()).toBe('closed');
    expect(cb.tryAcquire()).toBe(true);
  });

  it('stays closed with fewer failures than threshold', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    expect(cb.tryAcquire()).toBe(true);
  });

  it('opens after threshold failures within window', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.tryAcquire()).toBe(false);
  });

  it('stays open before cooldown elapses', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    clock.advance(29_999);
    expect(cb.getState()).toBe('open');
    expect(cb.tryAcquire()).toBe(false);
  });

  it('transitions to half-open after cooldown', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    clock.advance(30_000);
    expect(cb.tryAcquire()).toBe(true);
    expect(cb.getState()).toBe('half-open');
  });

  it('closes on success from half-open', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    clock.advance(30_000);
    cb.tryAcquire(); // transition to half-open and claim probe
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
    expect(cb.tryAcquire()).toBe(true);
  });

  it('reopens on failure from half-open with fresh cooldown', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    clock.advance(30_000);
    cb.tryAcquire(); // transition to half-open and claim probe
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    // cooldown resets — still open at 29s after reopening
    clock.advance(29_000);
    expect(cb.tryAcquire()).toBe(false);
    // opens again at 30s
    clock.advance(1_000);
    expect(cb.tryAcquire()).toBe(true);
    expect(cb.getState()).toBe('half-open');
  });

  it('half-open single-flight: only one concurrent caller gets true', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    clock.advance(30_000);

    // First call transitions to half-open, grants the permit, and claims the probe slot
    expect(cb.tryAcquire()).toBe(true);

    // Concurrent callers all get false while the probe is in flight
    expect(cb.tryAcquire()).toBe(false);
    expect(cb.tryAcquire()).toBe(false);

    // After the probe settles (success), the slot is released by recordSuccess
    cb.recordSuccess();
    expect(cb.tryAcquire()).toBe(true);
    expect(cb.getState()).toBe('closed');
  });

  it('recordAbandoned releases the half-open probe slot without ticking the breaker', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    clock.advance(30_000);

    // Claim the probe
    expect(cb.tryAcquire()).toBe(true);
    expect(cb.tryAcquire()).toBe(false);

    // Abandon — slot released, state still half-open (no failure recorded)
    cb.recordAbandoned();
    expect(cb.getState()).toBe('half-open');
    // Next caller can claim the probe again
    expect(cb.tryAcquire()).toBe(true);
  });

  it('recordAbandoned is a no-op when not half-open', () => {
    const cb = new CircuitBreaker(opts);
    cb.recordAbandoned();
    expect(cb.getState()).toBe('closed');
    expect(cb.tryAcquire()).toBe(true);
  });

  it('failures outside the window do not count toward threshold', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    // 4 failures inside window
    for (let i = 0; i < 4; i++) {
      cb.recordFailure();
      clock.advance(1_000);
    }
    // advance past window so the 4 failures expire
    clock.advance(60_000);
    // 1 new failure — should not open (only 1 in window now)
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
  });

  it('recordSuccess clears failure history and closes the circuit', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 4; i++) cb.recordFailure();
    cb.recordSuccess();
    // circuit is closed, failure count reset — needs threshold new failures to open
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.getState()).toBe('closed');
  });
});
