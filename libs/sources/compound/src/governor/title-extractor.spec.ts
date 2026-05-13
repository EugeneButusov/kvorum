import { describe, expect, it } from 'vitest';
import { extractCompoundTitle } from './title-extractor';

describe('extractCompoundTitle', () => {
  it('extracts a typical markdown heading title', () => {
    expect(extractCompoundTitle('# Proposal 42: Update COMP parameters\n\nBody')).toBe(
      'Proposal 42: Update COMP parameters',
    );
  });

  it('returns null for empty or whitespace-only descriptions', () => {
    expect(extractCompoundTitle('')).toBeNull();
    expect(extractCompoundTitle('\n  \n#   ')).toBeNull();
  });

  it('handles leading hash variants', () => {
    expect(extractCompoundTitle('##  Title')).toBe('Title');
    expect(extractCompoundTitle('#Title')).toBe('Title');
  });

  it('skips blank first lines', () => {
    expect(extractCompoundTitle('\n\n  # Real title\nBody')).toBe('Real title');
  });

  it('truncates very long titles to 200 characters with an ellipsis', () => {
    const title = 'x'.repeat(250);
    const extracted = extractCompoundTitle(`# ${title}`);

    expect(extracted).toHaveLength(200);
    expect(extracted).toBe(`${'x'.repeat(199)}…`);
  });

  it('preserves non-ASCII title content', () => {
    expect(extractCompoundTitle('# Réseau – 参数')).toBe('Réseau – 参数');
  });
});
