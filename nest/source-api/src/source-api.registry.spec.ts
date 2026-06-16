import { describe, expect, it } from 'vitest';
import type { SourceApiContribution } from '@libs/domain';
import { SourceApiRegistry } from './source-api.registry';

function makeContribution(sourceTypes: string[], max: number): SourceApiContribution {
  return {
    sourceTypes,
    choiceBounds: () => ({ min: 0, max }),
    getProposalExtension: () => Promise.resolve(null),
  };
}

describe('SourceApiRegistry', () => {
  it('returns choiceBounds from the matching contribution', () => {
    const registry = new SourceApiRegistry([
      makeContribution(['compound_governor_bravo'], 2),
      makeContribution(['aave_governance_v3'], 1),
    ]);
    expect(registry.choiceBounds('compound_governor_bravo')).toEqual({ min: 0, max: 2 });
    expect(registry.choiceBounds('aave_governance_v3')).toEqual({ min: 0, max: 1 });
  });

  it('returns wide default {min:0,max:2} for unknown source type', () => {
    const registry = new SourceApiRegistry([]);
    expect(registry.choiceBounds('unknown_source')).toEqual({ min: 0, max: 2 });
  });

  it('returns null from getProposalExtension for unknown source type', async () => {
    const registry = new SourceApiRegistry([]);
    const result = await registry.getProposalExtension('p1', 'unknown_source');
    expect(result).toBeNull();
  });

  it('delegates getProposalExtension to the matching contribution', async () => {
    const extension = {
      voting: {
        voting_chain_id: '0x89',
        voting_machine_address: null,
        voting_strategy_address: null,
        creation_block: '100',
      },
      payloads: [],
    };
    const contribution: SourceApiContribution = {
      sourceTypes: ['aave_governance_v3'],
      choiceBounds: () => ({ min: 0, max: 1 }),
      getProposalExtension: () => Promise.resolve(extension),
    };
    const registry = new SourceApiRegistry([contribution]);
    const result = await registry.getProposalExtension('p1', 'aave_governance_v3');
    expect(result).toBe(extension);
  });
});
