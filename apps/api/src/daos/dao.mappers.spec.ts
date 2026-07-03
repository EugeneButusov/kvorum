import type { SourceReadExtension } from '@libs/domain';
import { toDaoSourceDto } from './dao.mappers';
import { isoSeconds } from '../http/iso';

// Minimal source extensions: an EVM source (no override → EVM default) and off-chain snapshot/forum
// sources that curate their own config map. Mirrors how the real extensions are assembled.
const extensions: SourceReadExtension[] = [
  {
    sourceTypes: ['compound_governor_bravo', 'alt_governor'],
    choiceBounds: () => ({ min: 0, max: 2 }),
    delegationModel: () => 'power-bearing',
    getProposalExtension: () => Promise.resolve(null),
  },
  {
    sourceTypes: ['snapshot'],
    choiceBounds: () => ({ min: 0, max: 127 }),
    delegationModel: () => 'power-bearing',
    getProposalExtension: () => Promise.resolve(null),
    curateSourceConfig: (_t, raw) => ({
      off_chain: true,
      config:
        typeof (raw as { space?: unknown }).space === 'string'
          ? { space: (raw as { space: string }).space }
          : {},
    }),
  },
  {
    sourceTypes: ['discourse_forum'],
    choiceBounds: () => ({ min: 0, max: 0 }),
    delegationModel: () => 'relationship-only',
    getProposalExtension: () => Promise.resolve(null),
    curateSourceConfig: (_t, raw) => ({
      off_chain: true,
      config: {
        forum_host: (raw as { host: string }).host,
        forum_categories: (raw as { categories: unknown[] }).categories.filter(
          (c): c is string => typeof c === 'string',
        ),
      },
    }),
  },
];

describe('dao.mappers', () => {
  it('toDaoSourceDto curates an on-chain source via the EVM default', () => {
    const dto = toDaoSourceDto(
      {
        source_type: 'compound_governor_bravo',
        source_config: { contract_address: '0xEF', chain_id: '10' },
      },
      extensions,
    );
    expect(dto).toEqual({
      source_type: 'compound_governor_bravo',
      off_chain: false,
      config: { contract_address: '0xef', chain_id: '10' },
    });
    expect(Object.getPrototypeOf(dto).constructor.name).toBe('DaoSourceDto');
  });

  it('toDaoSourceDto marks snapshot off-chain and surfaces the space (source-driven)', () => {
    const dto = toDaoSourceDto(
      { source_type: 'snapshot', source_config: { space: 'lido-snapshot.eth' } },
      extensions,
    );
    expect(dto).toEqual({
      source_type: 'snapshot',
      off_chain: true,
      config: { space: 'lido-snapshot.eth' },
    });
  });

  it('toDaoSourceDto marks discourse_forum off-chain with host + categories (source-driven)', () => {
    const dto = toDaoSourceDto(
      {
        source_type: 'discourse_forum',
        source_config: { host: 'research.lido.fi', categories: ['proposals', 42] },
      },
      extensions,
    );
    expect(dto).toEqual({
      source_type: 'discourse_forum',
      off_chain: true,
      config: { forum_host: 'research.lido.fi', forum_categories: ['proposals'] },
    });
  });

  it('emits an empty config map when nothing is curated', () => {
    const dto = toDaoSourceDto({ source_type: 'alt_governor', source_config: {} }, extensions);
    expect(dto).toEqual({ source_type: 'alt_governor', off_chain: false, config: {} });
  });

  it('isoSeconds truncates milliseconds and supports null', () => {
    expect(isoSeconds(new Date('2026-05-15T10:00:00.123Z'))).toBe('2026-05-15T10:00:00Z');
    expect(isoSeconds(null)).toBeNull();
  });
});
