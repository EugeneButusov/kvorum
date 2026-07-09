import { formatCompactNumber, formatPower, formatRelativeTime } from './format';

describe('formatRelativeTime', () => {
  const now = 1_000_000_000_000;
  it.each([
    [now, 'just now'],
    [now - 30_000, '30s ago'],
    [now - 5 * 60_000, '5m ago'],
    [now - 3 * 3_600_000, '3h ago'],
    [now - 2 * 86_400_000, '2d ago'],
  ] as const)('formats a delta to %s', (t, expected) => {
    expect(formatRelativeTime(t, now)).toBe(expected);
  });
});

describe('formatCompactNumber / formatPower', () => {
  it('compacts large numbers to M/B', () => {
    expect(formatCompactNumber(1_234_567)).toBe('1.2M');
    expect(formatCompactNumber(3_400_000_000)).toBe('3.4B');
  });

  it('appends the unit', () => {
    expect(formatPower(1_234_567, 'COMP')).toBe('1.2M COMP');
    expect(formatPower(500)).toBe('500');
  });
});
