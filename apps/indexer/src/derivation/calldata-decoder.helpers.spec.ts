import { describe, expect, it, vi } from 'vitest';
import type { CalldataProtocolSupport, HeuristicResult, LoadedAbiLibrary } from '@sources/core';
import { makeBundledAbiResolver, makeHeuristicDecoder } from './calldata-decoder.helpers';

function makeLibrary(label: string): LoadedAbiLibrary {
  return {
    bySelector: new Map([[label, []]]),
  };
}

describe('calldata-decoder helpers', () => {
  describe('makeBundledAbiResolver', () => {
    it('returns the first matching protocol library', () => {
      const aaveLibrary = makeLibrary('aave');
      const compoundLibrary = makeLibrary('compound');
      const protocols: readonly CalldataProtocolSupport[] = [
        {
          supportsSourceType: (sourceType) => sourceType.startsWith('aave_'),
          loadAbiLibrary: () => aaveLibrary,
        },
        {
          supportsSourceType: (sourceType) => sourceType.startsWith('compound_'),
          loadAbiLibrary: () => compoundLibrary,
        },
      ];

      const bundledAbisFor = makeBundledAbiResolver(protocols);

      expect(bundledAbisFor('compound_governor_bravo')).toBe(compoundLibrary);
      expect(bundledAbisFor('aave_governance_v3')).toBe(aaveLibrary);
    });

    it('falls back to the shared library for unknown source types', () => {
      const bundledAbisFor = makeBundledAbiResolver([]);

      expect(bundledAbisFor('test_source_alpha').bySelector.size).toBeGreaterThan(0);
    });

    it('loads each protocol library once while building the resolver', () => {
      const loadAbiLibrary = vi.fn(() => makeLibrary('compound'));

      makeBundledAbiResolver([
        {
          supportsSourceType: (sourceType) => sourceType.startsWith('compound_'),
          loadAbiLibrary,
        },
      ]);

      expect(loadAbiLibrary).toHaveBeenCalledTimes(1);
    });
  });

  describe('makeHeuristicDecoder', () => {
    it('returns undefined when no protocols expose heuristics', () => {
      expect(makeHeuristicDecoder([])).toBeUndefined();
    });

    it('returns the first non-null heuristic result', () => {
      const firstDecode = vi
        .fn<(calldata: string) => HeuristicResult | null>()
        .mockReturnValue(null);
      const secondResult: HeuristicResult = {
        decodedFunction: 'approve(address,uint256)',
        decodedArguments: { spender: '0xabc' },
      };
      const secondDecode = vi
        .fn<(calldata: string) => HeuristicResult | null>()
        .mockReturnValue(secondResult);
      const thirdDecode = vi.fn<(calldata: string) => HeuristicResult | null>().mockReturnValue({
        decodedFunction: 'transfer(address,uint256)',
        decodedArguments: {},
      });

      const decodeByHeuristic = makeHeuristicDecoder([
        makeProtocol(firstDecode),
        makeProtocol(secondDecode),
        makeProtocol(thirdDecode),
      ]);

      expect(decodeByHeuristic?.('0xdeadbeef')).toBe(secondResult);
      expect(firstDecode).toHaveBeenCalledTimes(1);
      expect(secondDecode).toHaveBeenCalledTimes(1);
      expect(thirdDecode).not.toHaveBeenCalled();
    });
  });
});

function makeProtocol(
  decodeByHeuristic?: (calldata: string) => HeuristicResult | null,
): CalldataProtocolSupport {
  return {
    supportsSourceType: () => false,
    loadAbiLibrary: () => makeLibrary('unused'),
    decodeByHeuristic,
  };
}
