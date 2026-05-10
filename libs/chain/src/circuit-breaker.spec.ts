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
  it('starts closed and allows requests', () => {
    const cb = new CircuitBreaker(opts);
    expect(cb.getState()).toBe('closed');
    expect(cb.canRequest()).toBe(true);
  });

  it('stays closed with fewer failures than threshold', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    expect(cb.canRequest()).toBe(true);
  });

  it('opens after threshold failures within window', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.canRequest()).toBe(false);
  });

  it('stays open before cooldown elapses', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    clock.advance(29_999);
    expect(cb.getState()).toBe('open');
    expect(cb.canRequest()).toBe(false);
  });

  it('transitions to half-open after cooldown', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    clock.advance(30_000);
    expect(cb.canRequest()).toBe(true);
    expect(cb.getState()).toBe('half-open');
  });

  it('closes on success from half-open', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    clock.advance(30_000);
    cb.canRequest(); // transition to half-open
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
    expect(cb.canRequest()).toBe(true);
  });

  it('reopens on failure from half-open with fresh cooldown', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    clock.advance(30_000);
    cb.canRequest(); // transition to half-open
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    // cooldown resets — still open at 29s after reopening
    clock.advance(29_000);
    expect(cb.canRequest()).toBe(false);
    // opens again at 30s
    clock.advance(1_000);
    expect(cb.canRequest()).toBe(true);
    expect(cb.getState()).toBe('half-open');
  });

  it('half-open single-flight: only one concurrent caller gets true', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ ...opts, now: clock.now });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    clock.advance(30_000);

    // First call transitions to half-open and grants the permit
    expect(cb.canRequest()).toBe(true);
    // Simulate probe in flight
    cb.inFlightProbe = Promise.resolve();

    // Concurrent callers all get false while probe is in flight
    expect(cb.canRequest()).toBe(false);
    expect(cb.canRequest()).toBe(false);

    // After probe settles (success), inFlightProbe is cleared by recordSuccess
    cb.recordSuccess();
    expect(cb.canRequest()).toBe(true);
    expect(cb.getState()).toBe('closed');
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
