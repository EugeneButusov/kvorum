import { bandCenters, extent, linear } from './scale';

describe('linear', () => {
  it('maps the domain onto the range', () => {
    const s = linear([0, 10], [0, 100]);
    expect(s(0)).toBe(0);
    expect(s(5)).toBe(50);
    expect(s(10)).toBe(100);
  });
  it('inverts when the range is descending (SVG y-down)', () => {
    const s = linear([0, 1], [100, 0]);
    expect(s(0)).toBe(100);
    expect(s(1)).toBe(0);
  });
  it('does not divide by zero on a flat domain', () => {
    expect(linear([5, 5], [0, 100])(5)).toBe(0);
  });
});

describe('extent', () => {
  it('returns min/max', () => {
    expect(extent([3, 1, 4, 1, 5])).toEqual([1, 5]);
  });
  it('floors at zero when asked', () => {
    expect(extent([3, 5, 4], { includeZero: true })).toEqual([0, 5]);
  });
  it('gives a unit span for a flat or empty series', () => {
    expect(extent([7, 7])).toEqual([7, 8]);
    expect(extent([])).toEqual([0, 1]);
  });
});

describe('bandCenters', () => {
  it('spaces N centers evenly across the range', () => {
    expect(bandCenters(2, [0, 100])).toEqual([25, 75]);
  });
  it('centers a single band', () => {
    expect(bandCenters(1, [0, 100])).toEqual([50]);
  });
  it('returns nothing for zero bands', () => {
    expect(bandCenters(0, [0, 100])).toEqual([]);
  });
});
