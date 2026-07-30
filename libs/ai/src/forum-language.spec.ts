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
    expect(isLikelyEnglish('你好，世界。这是一条测试消息。')).toBe(false);
  });

  it('rejects a predominantly Cyrillic thread', () => {
    expect(isLikelyEnglish('Привет, мир. Это тестовое сообщение.')).toBe(false);
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
