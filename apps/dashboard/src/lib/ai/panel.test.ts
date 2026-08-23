import { toAiConfidence, toProvenance } from './panel';

describe('toAiConfidence', () => {
  it('passes through the three valid tiers', () => {
    expect(toAiConfidence('high')).toBe('high');
    expect(toAiConfidence('medium')).toBe('medium');
    expect(toAiConfidence('low')).toBe('low');
  });

  it('returns undefined for anything else', () => {
    expect(toAiConfidence('none')).toBeUndefined();
    expect(toAiConfidence(null)).toBeUndefined();
    expect(toAiConfidence(undefined)).toBeUndefined();
  });
});

describe('toProvenance', () => {
  it('maps the API meta onto panel provenance, parsing the timestamp to ms', () => {
    const p = toProvenance({
      model: 'claude-sonnet',
      prompt_version: 'v3',
      generated_at: '2026-08-01T00:00:00.000Z',
    });
    expect(p).toEqual({
      model: 'claude-sonnet',
      promptVersion: 'v3',
      generatedAt: Date.parse('2026-08-01T00:00:00.000Z'),
    });
  });

  it('drops an unparseable timestamp rather than emitting NaN', () => {
    const p = toProvenance({ model: 'm', generated_at: 'not-a-date' });
    expect(p?.generatedAt).toBeUndefined();
    expect(p?.model).toBe('m');
  });

  it('returns undefined when nothing meaningful is present (no empty disclosure)', () => {
    expect(toProvenance(undefined)).toBeUndefined();
    expect(toProvenance(null)).toBeUndefined();
    expect(toProvenance({})).toBeUndefined();
  });
});
