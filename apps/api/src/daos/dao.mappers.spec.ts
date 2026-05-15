import { curateSourceConfig, isoSeconds, toDaoSourceDto } from './dao.mappers';

describe('dao.mappers', () => {
  it('curateSourceConfig extracts only whitelisted keys', () => {
    expect(
      curateSourceConfig({
        contract_address: '0xABCD',
        chain_id: 1,
        extra: 'ignored',
      }),
    ).toEqual({
      contract_address: '0xabcd',
      chain_id: '1',
    });
  });

  it('curateSourceConfig handles invalid shapes without throwing', () => {
    expect(curateSourceConfig(null)).toEqual({});
    expect(curateSourceConfig(['x'])).toEqual({});
    expect(curateSourceConfig('x')).toEqual({});
    expect(curateSourceConfig({})).toEqual({});
  });

  it('toDaoSourceDto preserves source_type and curated fields', () => {
    expect(
      toDaoSourceDto({
        source_type: 'compound_governor',
        source_config: { contract_address: '0xEF', chain_id: '10' },
      }),
    ).toEqual({
      source_type: 'compound_governor',
      contract_address: '0xef',
      chain_id: '10',
    });
  });

  it('isoSeconds truncates milliseconds and supports null', () => {
    expect(isoSeconds(new Date('2026-05-15T10:00:00.123Z'))).toBe('2026-05-15T10:00:00Z');
    expect(isoSeconds(null)).toBeNull();
  });
});
