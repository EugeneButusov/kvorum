import { describe, it, expect } from 'vitest';
import { extractSnapshotTitle } from './title-extractor';

describe('extractSnapshotTitle', () => {
  it('returns null for null/undefined/empty', () => {
    expect(extractSnapshotTitle(null)).toBeNull();
    expect(extractSnapshotTitle(undefined)).toBeNull();
    expect(extractSnapshotTitle('   ')).toBeNull();
    expect(extractSnapshotTitle('  ##  ')).toBeNull();
  });

  it('trims and strips a leading markdown heading', () => {
    expect(extractSnapshotTitle('  ## Upgrade the treasury  ')).toBe('Upgrade the treasury');
  });

  it('passes a normal title through', () => {
    expect(extractSnapshotTitle('LIP-42: Do the thing')).toBe('LIP-42: Do the thing');
  });

  it('caps at 200 chars with an ellipsis', () => {
    const long = 'a'.repeat(250);
    const result = extractSnapshotTitle(long)!;
    expect(result).toHaveLength(200);
    expect(result.endsWith('…')).toBe(true);
  });
});
