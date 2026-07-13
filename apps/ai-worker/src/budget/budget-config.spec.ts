import { afterEach, describe, expect, it } from 'vitest';
import { AI_FEATURES, readCap, startOfCurrentMonthUtc } from './budget-config';

describe('budget-config', () => {
  afterEach(() => {
    delete process.env['AI_CAP_SUMMARIZE_USD'];
  });

  it('lists exactly the four AI features', () => {
    expect([...AI_FEATURES].sort()).toEqual(
      ['embedding', 'forum_synthesizer', 'mismatch_detector', 'proposal_summarizer'].sort(),
    );
  });

  it('readCap returns the SPEC default when env is unset', () => {
    expect(readCap('proposal_summarizer')).toBe(5);
    expect(readCap('mismatch_detector')).toBe(20);
    expect(readCap('forum_synthesizer')).toBe(15);
    expect(readCap('embedding')).toBe(1);
  });

  it('readCap reads the env override (fractional) per call', () => {
    process.env['AI_CAP_SUMMARIZE_USD'] = '7.5';
    expect(readCap('proposal_summarizer')).toBe(7.5);
  });

  it('readCap falls back to default for a malformed/non-positive env', () => {
    process.env['AI_CAP_SUMMARIZE_USD'] = 'nope';
    expect(readCap('proposal_summarizer')).toBe(5);
  });

  it('startOfCurrentMonthUtc returns the UTC first-of-month at 00:00:00', () => {
    expect(startOfCurrentMonthUtc(new Date('2026-07-12T15:30:00Z')).toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
    // year/month rollover: January
    expect(startOfCurrentMonthUtc(new Date('2026-01-05T09:00:00Z')).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });
});
