import { describe, expect, it } from 'vitest';
import { isLikelyEnglish } from './forum-language.js';

describe('isLikelyEnglish', () => {
  it('accepts ordinary English prose', () => {
    expect(
      isLikelyEnglish('I support this proposal because the treasury allocation looks reasonable.'),
    ).toBe(true);
  });

  it('accepts English threads full of addresses, code and @handles (Latin + digits)', () => {
    expect(
      isLikelyEnglish(
        '**@alice** at 2026-01-01\nDeploy to 0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5\n```\nsetReserveFactor(1e17)\n```',
      ),
    ).toBe(true);
  });

  it('rejects a predominantly Chinese thread', () => {
    expect(isLikelyEnglish('我反对这个提案，因为国库分配看起来不合理，风险太大了。')).toBe(false);
  });

  it('rejects a predominantly Cyrillic thread', () => {
    expect(
      isLikelyEnglish('Я против этого предложения, потому что распределение казны рискованно.'),
    ).toBe(false);
  });

  it('keeps a mostly-English thread that only quotes a little non-English', () => {
    const mostlyEnglish =
      'I broadly support this. One member noted 你好 in passing but the discussion is in English ' +
      'and covers the treasury, the risk parameters, and the timeline in detail.';
    expect(isLikelyEnglish(mostlyEnglish)).toBe(true);
  });

  it('does not skip when there are no letters to judge (empty / punctuation / numbers)', () => {
    expect(isLikelyEnglish('')).toBe(true);
    expect(isLikelyEnglish('   \n\t  ')).toBe(true);
    expect(isLikelyEnglish('0x1234 5678 --- ### ...')).toBe(true);
  });
});
