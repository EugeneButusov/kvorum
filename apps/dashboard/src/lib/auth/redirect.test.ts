import { safeNext } from './redirect';

describe('safeNext', () => {
  it('keeps a same-origin absolute path', () => {
    expect(safeNext('/developer')).toBe('/developer');
    expect(safeNext('/daos/lido/proposals')).toBe('/daos/lido/proposals');
  });

  it('falls back to /developer for missing or unsafe targets', () => {
    expect(safeNext(undefined)).toBe('/developer');
    expect(safeNext('')).toBe('/developer');
    expect(safeNext('//evil.example')).toBe('/developer');
    expect(safeNext('https://evil.example')).toBe('/developer');
    expect(safeNext('javascript:alert(1)')).toBe('/developer');
  });
});
