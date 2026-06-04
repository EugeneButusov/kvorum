import { describe, expect, it, vi } from 'vitest';
import { CalldataDecoder } from '@sources/core';
import type { DecoderDependencies } from '@sources/core';
import FIXTURE from './__fixtures__/historical-actions.json' with { type: 'json' };
import { loadAbiLibrary } from './abi-library';

type FixtureEntry = {
  targetAddress: string;
  calldata: string;
  expectedFunction: string;
};

const CHAIN = '1';
const SOURCE_TYPE = 'aave_governance_v3';

function makeDeps(): DecoderDependencies {
  return {
    abiCache: {
      findByAddress: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
    } as unknown as DecoderDependencies['abiCache'],
    selectorIndex: {
      lookupBySelector: vi.fn().mockResolvedValue([]),
      bulkInsert: vi.fn().mockResolvedValue(0),
    } as unknown as DecoderDependencies['selectorIndex'],
    bundledAbisFor: vi.fn().mockImplementation(() => loadAbiLibrary()),
    decodeByHeuristic: undefined,
    proxyResolverFor: vi.fn().mockReturnValue({
      resolve: vi.fn().mockResolvedValue({
        implementation: null,
        path: [],
        capped: false,
        reason: 'not_a_proxy',
      }),
    }),
    etherscanClient: null,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('Aave calldata decoder', () => {
  it('decodes the historical fixture with at least 95% coverage', async () => {
    const deps = makeDeps();
    const decoder = new CalldataDecoder(deps);
    const fixture = FIXTURE as FixtureEntry[];
    let decoded = 0;

    for (const row of fixture) {
      const result = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: row.targetAddress,
        calldata: row.calldata,
        functionSignature: null,
      });

      if (result.kind !== 'decoded') continue;
      decoded += 1;
      expect(result.decodedFunction).toBe(row.expectedFunction);
    }

    expect(decoded / fixture.length).toBeGreaterThanOrEqual(0.95);
  });
});
