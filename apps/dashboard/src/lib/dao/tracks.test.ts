import { trackDescription } from './tracks';

describe('trackDescription', () => {
  it('describes known Lido tracks', () => {
    expect(trackDescription('aragon_voting')).toMatch(/LDO holders/);
    expect(trackDescription('dual_governance')).toMatch(/stETH/);
  });

  it('falls back for an unknown source', () => {
    expect(trackDescription('mystery_source')).toMatch(/distinct governance track/);
  });
});
