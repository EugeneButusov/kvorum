import { curateSourceConfig, toDaoSourceDto } from './dao.mappers';
import { isoSeconds } from '../http/iso';

describe('dao.mappers', () => {
  it('curateSourceConfig extracts only whitelisted keys', () => {
    expect(
      curateSourceConfig({
        contract_address: '0xABCD',
        chain_id: '0x1',
        extra: 'ignored',
      }),
    ).toEqual({
      contract_address: '0xabcd',
      chain_id: '0x1',
    });
  });

  it('curateSourceConfig handles invalid shapes without throwing', () => {
    expect(curateSourceConfig(null)).toEqual({});
    expect(curateSourceConfig(['x'])).toEqual({});
    expect(curateSourceConfig('x')).toEqual({});
    expect(curateSourceConfig({})).toEqual({});
  });

  it('curateSourceConfig stringifies numeric chain_id', () => {
    expect(
      curateSourceConfig({
        contract_address: '0xABCD',
        chain_id: 1,
      }),
    ).toEqual({
      contract_address: '0xabcd',
      chain_id: '1',
    });
  });

  it('toDaoSourceDto preserves source_type and curated fields (on-chain)', () => {
    const dto = toDaoSourceDto({
      source_type: 'compound_governor_bravo',
      source_config: { contract_address: '0xEF', chain_id: '10' },
    });
    expect(dto).toEqual({
      source_type: 'compound_governor_bravo',
      off_chain: false,
      contract_address: '0xef',
      chain_id: '10',
    });
    expect(Object.getPrototypeOf(dto).constructor.name).toBe('DaoSourceDto');
  });

  it('toDaoSourceDto marks snapshot off-chain and surfaces the space', () => {
    const dto = toDaoSourceDto({
      source_type: 'snapshot',
      source_config: { space: 'lido-snapshot.eth' },
    });
    expect(dto).toEqual({
      source_type: 'snapshot',
      off_chain: true,
      space: 'lido-snapshot.eth',
    });
  });

  it('toDaoSourceDto marks discourse_forum off-chain with host + categories', () => {
    const dto = toDaoSourceDto({
      source_type: 'discourse_forum',
      source_config: { host: 'research.lido.fi', categories: ['proposals', 42] },
    });
    expect(dto).toEqual({
      source_type: 'discourse_forum',
      off_chain: true,
      forum_host: 'research.lido.fi',
      forum_categories: ['proposals'],
    });
  });

  it('omits curated-absent fields without null/undefined leakage', () => {
    const dto = toDaoSourceDto({
      source_type: 'alt_governor',
      source_config: {},
    });
    expect(Object.prototype.hasOwnProperty.call(dto, 'contract_address')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(dto, 'chain_id')).toBe(false);
    expect(JSON.stringify(dto)).not.toContain('contract_address');
    expect(JSON.stringify(dto)).not.toContain('chain_id');
  });

  it('isoSeconds truncates milliseconds and supports null', () => {
    expect(isoSeconds(new Date('2026-05-15T10:00:00.123Z'))).toBe('2026-05-15T10:00:00Z');
    expect(isoSeconds(null)).toBeNull();
  });
});
