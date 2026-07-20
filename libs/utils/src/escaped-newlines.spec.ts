import { describe, expect, it } from 'vitest';
import { normalizeEscapedNewlines } from './escaped-newlines';

describe('normalizeEscapedNewlines', () => {
  it('restores the line breaks a JSON-encoded description lost', () => {
    // The shape observed on Compound proposal 591: markdown with every newline escaped.
    const broken = '# Deprecation of Polygon Comets\\n## Simple Summary\\n\\nGauntlet recommends…';

    expect(normalizeEscapedNewlines(broken)).toBe(
      '# Deprecation of Polygon Comets\n## Simple Summary\n\nGauntlet recommends…',
    );
  });

  it('makes the first line the title again, instead of the whole description', () => {
    const broken =
      '# Real Title\\n\\nA long body that would otherwise be swallowed into the title.';

    expect(normalizeEscapedNewlines(broken).split('\n')[0]).toBe('# Real Title');
  });

  it('lets markdown structure parse again', () => {
    const fixed = normalizeEscapedNewlines('## Heading\\n\\n| a | b |\\n| - | - |\\n| 1 | 2 |');

    expect(fixed.match(/^#{1,3} .+$/gm)).toHaveLength(1);
    expect(fixed.match(/^\|.*\|$/gm)).toHaveLength(3);
  });

  it('leaves a healthy description exactly as it is', () => {
    const healthy = '# Title\n\nBody with real newlines.\n\n| a | b |\n| - | - |';

    expect(normalizeEscapedNewlines(healthy)).toBe(healthy);
  });

  it('leaves text that legitimately shows a \\n escape alone, because it has real newlines', () => {
    // A code sample discussing escapes must not be rewritten — the real-newline guard covers it.
    const withSample = 'Use "\\n" to break a line.\n\nThat is the convention.';

    expect(normalizeEscapedNewlines(withSample)).toBe(withSample);
  });

  it('leaves single-line text with no escapes alone', () => {
    expect(normalizeEscapedNewlines('Just a plain one-line title')).toBe(
      'Just a plain one-line title',
    );
  });

  it('is a no-op on an empty string', () => {
    expect(normalizeEscapedNewlines('')).toBe('');
  });

  it('also restores escaped carriage returns and tabs', () => {
    expect(normalizeEscapedNewlines('a\\r\\nb\\tc')).toBe('a\nb\tc');
  });

  it('does not touch a lone backslash or an unrelated escape', () => {
    const path = 'C:\\Users\\alice';

    expect(normalizeEscapedNewlines(path)).toBe(path);
  });
});
