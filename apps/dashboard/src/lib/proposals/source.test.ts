import { sourceLabel } from './source';

describe('sourceLabel', () => {
  it('reads a source_type as prose', () => {
    expect(sourceLabel('aragon_voting')).toBe('Aragon voting');
  });

  it('leaves a single-word source_type alone but for its capital', () => {
    expect(sourceLabel('snapshot')).toBe('Snapshot');
  });
});
