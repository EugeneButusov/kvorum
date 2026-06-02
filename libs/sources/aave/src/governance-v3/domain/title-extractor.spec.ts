import { describe, expect, it } from 'vitest';
import { extractAaveTitle } from './title-extractor';

describe('extractAaveTitle', () => {
  it('prefers the explicit JSON title', () => {
    expect(
      extractAaveTitle({
        title: '  ## Direct title  ',
        description: '# Fallback title\nBody',
      }),
    ).toBe('Direct title');
  });

  it('falls back to the first non-empty description line', () => {
    expect(extractAaveTitle({ description: '\n\n  # Real title\nBody' })).toBe('Real title');
  });

  it('returns null when no usable title exists', () => {
    expect(extractAaveTitle({ title: '   ', description: '\n  \n#   ' })).toBeNull();
  });

  it('truncates titles to 200 characters total', () => {
    const raw = `# ${'a'.repeat(201)}`;
    expect(extractAaveTitle({ description: raw })).toBe(`${'a'.repeat(199)}…`);
  });
});
