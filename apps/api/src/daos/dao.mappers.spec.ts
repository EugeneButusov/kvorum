import type { SourceReadExtension } from '@libs/domain';
import { toDaoSourceDto } from './dao.mappers';
import { isoSeconds } from '../http/iso';

// Abstract source extensions — the mapper is source-blind, so these stand in for any source:
// `evm_source`/`bare_source` rely on the EVM default (no curateSourceConfig override); the others
// curate arbitrary config maps to prove the mapper surfaces whatever a source returns.
const extensions: SourceReadExtension[] = [
  {
    sourceTypes: ['evm_source', 'bare_source'],
    choiceBounds: () => ({ min: 0, max: 2 }),
    delegationModel: () => 'power-bearing',
    getProposalExtension: () => Promise.resolve(null),
  },
  {
    sourceTypes: ['scalar_source'],
    choiceBounds: () => ({ min: 0, max: 1 }),
    delegationModel: () => 'power-bearing',
    getProposalExtension: () => Promise.resolve(null),
    curateSourceConfig: (_t, raw) =>
      typeof (raw as { key?: unknown }).key === 'string'
        ? { binding: (raw as { key: string }).key }
        : {},
  },
  {
    sourceTypes: ['multi_field_source'],
    choiceBounds: () => ({ min: 0, max: 0 }),
    delegationModel: () => 'relationship-only',
    getProposalExtension: () => Promise.resolve(null),
    curateSourceConfig: (_t, raw) => ({
      host: (raw as { host: string }).host,
      tags: (raw as { tags: unknown[] }).tags.filter((c): c is string => typeof c === 'string'),
    }),
  },
];

describe('dao.mappers', () => {
  it('toDaoSourceDto curates a source with no override via the EVM default', () => {
    const dto = toDaoSourceDto(
      { source_type: 'evm_source', source_config: { contract_address: '0xEF', chain_id: '10' } },
      extensions,
    );
    expect(dto).toEqual({
      source_type: 'evm_source',
      config: { contract_address: '0xef', chain_id: '10' },
    });
    expect(Object.getPrototypeOf(dto).constructor.name).toBe('DaoSourceDto');
  });

  it('toDaoSourceDto surfaces a source-curated scalar binding', () => {
    const dto = toDaoSourceDto(
      { source_type: 'scalar_source', source_config: { key: 'abstract-binding' } },
      extensions,
    );
    expect(dto).toEqual({ source_type: 'scalar_source', config: { binding: 'abstract-binding' } });
  });

  it('toDaoSourceDto surfaces string + array config values', () => {
    const dto = toDaoSourceDto(
      {
        source_type: 'multi_field_source',
        source_config: { host: 'host.example', tags: ['a', 42] },
      },
      extensions,
    );
    expect(dto).toEqual({
      source_type: 'multi_field_source',
      config: { host: 'host.example', tags: ['a'] },
    });
  });

  it('emits an empty config map when nothing is curated', () => {
    const dto = toDaoSourceDto({ source_type: 'bare_source', source_config: {} }, extensions);
    expect(dto).toEqual({ source_type: 'bare_source', config: {} });
  });

  it('isoSeconds truncates milliseconds and supports null', () => {
    expect(isoSeconds(new Date('2026-05-15T10:00:00.123Z'))).toBe('2026-05-15T10:00:00Z');
    expect(isoSeconds(null)).toBeNull();
  });
});
