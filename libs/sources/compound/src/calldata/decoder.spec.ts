import { AbiCoder, FunctionFragment } from 'ethers';
import { describe, it, expect, vi } from 'vitest';
import type { DecoderDependencies } from '@sources/core';
import { CalldataDecoder } from '@sources/core';
import { ChainNotReadyError } from '@sources/core';
import FIXTURE from './__fixtures__/historical-actions.json' with { type: 'json' };
import { loadAbiLibrary } from './abi-library';
import { decodeByHeuristic } from './heuristics';

type FixtureEntry = { sig: string; calldata: string };

const coder = AbiCoder.defaultAbiCoder();
const CHAIN = '1';
const ADDR = '0x0000000000000000000000000000000000000001';
const PROXY = '0x000000000000000000000000000000000000beef';
const IMPL = '0x000000000000000000000000000000000000cafe';
const SOURCE_TYPE = 'compound_governor_bravo';

// Custom function not in heuristics or bundled library.
const CUSTOM_SIG = 'customFn(uint256)';
const CUSTOM_ABI = [
  {
    type: 'function',
    name: 'customFn',
    inputs: [{ name: 'val', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
];

function makeCalldata(sig: string, types: string[], values: unknown[]): string {
  const selector = FunctionFragment.from(sig).selector;
  if (types.length === 0) return selector;
  return selector + coder.encode(types, values).slice(2);
}

function makeDeps(overrides: Partial<DecoderDependencies> = {}): DecoderDependencies {
  return {
    abiCache: {
      findByAddress: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
    } as unknown as DecoderDependencies['abiCache'],
    selectorIndex: {
      lookupBySelector: vi.fn().mockResolvedValue([]),
      bulkInsert: vi.fn().mockResolvedValue(0),
    } as unknown as DecoderDependencies['selectorIndex'],
    bundledAbisFor: vi.fn().mockReturnValue(loadAbiLibrary()),
    decodeByHeuristic,
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
    ...overrides,
  };
}

describe('CalldataDecoder', () => {
  describe('Step 1 — sanity / empty calldata', () => {
    it('decodes empty calldata as fallback()', async () => {
      const decoder = new CalldataDecoder(makeDeps());
      const r = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: ADDR,
        calldata: '0x',
        functionSignature: null,
      });
      expect(r).toEqual({
        kind: 'decoded',
        decodedFunction: 'fallback()',
        decodedArguments: {},
        source: 'empty_calldata',
      });
    });

    it('returns miss for malformed calldata', async () => {
      const decoder = new CalldataDecoder(makeDeps());
      const r = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: ADDR,
        calldata: '0xgg',
        functionSignature: null,
      });
      expect(r).toEqual({ kind: 'miss' });
    });

    it('returns miss for calldata shorter than 4 bytes', async () => {
      const decoder = new CalldataDecoder(makeDeps());
      const r = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: ADDR,
        calldata: '0xab12',
        functionSignature: null,
      });
      expect(r).toEqual({ kind: 'miss' });
    });
  });

  describe('Step 2 — heuristic decoder', () => {
    it('decodes transfer(address,uint256)', async () => {
      const calldata = makeCalldata(
        'transfer(address,uint256)',
        ['address', 'uint256'],
        [ADDR, 1n],
      );
      const decoder = new CalldataDecoder(makeDeps());
      const r = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: ADDR,
        calldata,
        functionSignature: null,
      });
      expect(r).toMatchObject({
        kind: 'decoded',
        decodedFunction: 'transfer(address,uint256)',
        source: 'heuristic',
      });
    });

    it('decodes _acceptAdmin() with no args', async () => {
      const calldata = FunctionFragment.from('_acceptAdmin()').selector;
      const decoder = new CalldataDecoder(makeDeps());
      const r = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: ADDR,
        calldata,
        functionSignature: null,
      });
      expect(r).toEqual({
        kind: 'decoded',
        decodedFunction: '_acceptAdmin()',
        decodedArguments: {},
        source: 'heuristic',
      });
    });
  });

  describe('Step 3 — event_emitted shortcut', () => {
    // execute() selector (0x61461954) is not in heuristics or bundled library.
    const EXECUTE_CALLDATA = FunctionFragment.from('execute()').selector;

    it('decodes selector-only calldata via functionSignature', async () => {
      const decoder = new CalldataDecoder(makeDeps());
      const r = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: ADDR,
        calldata: EXECUTE_CALLDATA,
        functionSignature: 'execute()',
      });
      expect(r).toEqual({
        kind: 'decoded',
        decodedFunction: 'execute()',
        decodedArguments: {},
        source: 'event_emitted',
      });
    });

    it('logs warn and falls through when functionSignature selector does not match calldata', async () => {
      const deps = makeDeps();
      const decoder = new CalldataDecoder(deps);
      await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: ADDR,
        calldata: EXECUTE_CALLDATA,
        functionSignature: 'vote(uint256)',
      });
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'event_emitted_selector_mismatch',
        expect.anything(),
      );
    });
  });

  describe('Step 4 — abi_cache hit', () => {
    it('decodes using a cached ABI', async () => {
      const calldata = makeCalldata(CUSTOM_SIG, ['uint256'], [42n]);
      const deps = makeDeps({
        abiCache: {
          findByAddress: vi.fn().mockResolvedValue({ abi: CUSTOM_ABI }),
          upsert: vi.fn().mockResolvedValue(undefined),
        } as unknown as DecoderDependencies['abiCache'],
      });
      const decoder = new CalldataDecoder(deps);
      const r = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: ADDR,
        calldata,
        functionSignature: null,
      });
      expect(r).toMatchObject({
        kind: 'decoded',
        decodedFunction: 'customFn(uint256)',
        source: 'abi_cache',
      });
    });
  });

  describe('Step 5 — bundled ABI library', () => {
    it('decodes transferFrom(address,address,uint256) via erc20 library entry', async () => {
      const calldata = makeCalldata(
        'transferFrom(address,address,uint256)',
        ['address', 'address', 'uint256'],
        [ADDR, ADDR, 100n],
      );
      const deps = makeDeps();
      const decoder = new CalldataDecoder(deps);
      const r = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: ADDR,
        calldata,
        functionSignature: null,
      });
      expect(r).toMatchObject({
        kind: 'decoded',
        decodedFunction: 'transferFrom(address,address,uint256)',
        source: 'bundled_library',
      });
      expect(deps.abiCache.upsert).toHaveBeenCalled();
    });

    it('logs selector_collision_in_library warn when a selector has multiple candidates', async () => {
      const tfSel = FunctionFragment.from(
        'transferFrom(address,address,uint256)',
      ).selector.toLowerCase();
      const realLib = loadAbiLibrary();
      const realBucket = realLib.bySelector.get(tfSel)!;
      // Duplicate the bucket entry to simulate a collision.
      const collisionMap = new Map(realLib.bySelector);
      collisionMap.set(tfSel, [...realBucket, ...realBucket]);

      const deps = makeDeps({ bundledAbisFor: () => ({ bySelector: collisionMap }) });
      const decoder = new CalldataDecoder(deps);
      const calldata = makeCalldata(
        'transferFrom(address,address,uint256)',
        ['address', 'address', 'uint256'],
        [ADDR, ADDR, 1n],
      );
      const r = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: ADDR,
        calldata,
        functionSignature: null,
      });
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'selector_collision_in_library',
        expect.anything(),
      );
      expect(r.kind).toBe('decoded');
    });
  });

  describe('Step 6 — proxy resolution with R11 dual-cache', () => {
    it('decodes via implementation and writes two abi_cache upserts', async () => {
      const calldata = makeCalldata(CUSTOM_SIG, ['uint256'], [99n]);
      const upsertMock = vi.fn().mockResolvedValue(undefined);
      const findMock = vi
        .fn()
        .mockImplementation((_chain: string, address: string) =>
          address === IMPL ? Promise.resolve({ abi: CUSTOM_ABI }) : Promise.resolve(undefined),
        );

      const deps = makeDeps({
        abiCache: {
          findByAddress: findMock,
          upsert: upsertMock,
        } as unknown as DecoderDependencies['abiCache'],
        proxyResolverFor: vi.fn().mockReturnValue({
          resolve: vi.fn().mockResolvedValue({
            implementation: IMPL,
            path: [
              {
                proxyAddress: PROXY,
                slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
                kind: 'eip1967',
              },
            ],
            capped: false,
            reason: 'resolved',
          }),
        }),
      });

      const decoder = new CalldataDecoder(deps);
      const r = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: PROXY,
        calldata,
        functionSignature: null,
      });

      expect(r).toMatchObject({
        kind: 'decoded',
        decodedFunction: 'customFn(uint256)',
        source: 'proxy_resolved',
      });
      // R11: proxy row + impl row
      expect(upsertMock).toHaveBeenCalledTimes(2);
      const upsertAddresses = upsertMock.mock.calls.map(
        (c) => (c[0] as { address: string }).address,
      );
      expect(upsertAddresses).toContain(PROXY);
      expect(upsertAddresses).toContain(IMPL);
    });
  });

  describe('Step 7 — Etherscan enrichment', () => {
    it('decodes via Etherscan and populates abi_cache + selector_index', async () => {
      const calldata = makeCalldata(CUSTOM_SIG, ['uint256'], [7n]);
      const upsertMock = vi.fn().mockResolvedValue(undefined);
      const bulkInsertMock = vi.fn().mockResolvedValue(1);

      const deps = makeDeps({
        abiCache: {
          findByAddress: vi.fn().mockResolvedValue(undefined),
          upsert: upsertMock,
        } as unknown as DecoderDependencies['abiCache'],
        selectorIndex: {
          lookupBySelector: vi.fn().mockResolvedValue([]),
          bulkInsert: bulkInsertMock,
        } as unknown as DecoderDependencies['selectorIndex'],
        etherscanClient: { fetchAbi: vi.fn().mockResolvedValue(CUSTOM_ABI) },
      });

      const decoder = new CalldataDecoder(deps);
      const r = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: ADDR,
        calldata,
        functionSignature: null,
      });
      expect(r).toMatchObject({
        kind: 'decoded',
        decodedFunction: 'customFn(uint256)',
        source: 'etherscan',
      });
      expect(upsertMock).toHaveBeenCalled();
      expect(bulkInsertMock).toHaveBeenCalled();
    });
  });

  describe('Step 8 — selector_index partial', () => {
    it('returns partial when selector is in the index', async () => {
      const calldata = makeCalldata(CUSTOM_SIG, ['uint256'], [8n]);
      const selector = FunctionFragment.from(CUSTOM_SIG).selector.toLowerCase();

      const deps = makeDeps({
        selectorIndex: {
          lookupBySelector: vi
            .fn()
            .mockResolvedValue([
              { selector, signature: CUSTOM_SIG, source: 'etherscan', imported_at: new Date() },
            ]),
          bulkInsert: vi.fn().mockResolvedValue(0),
        } as unknown as DecoderDependencies['selectorIndex'],
      });

      const decoder = new CalldataDecoder(deps);
      const r = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: ADDR,
        calldata,
        functionSignature: null,
      });
      expect(r).toEqual({
        kind: 'partial',
        decodedFunction: null,
        functionSignatureGuess: CUSTOM_SIG,
        source: 'selector_index',
      });
    });
  });

  describe('Step 9 — miss', () => {
    it('returns miss when no pipeline step matches', async () => {
      const calldata = makeCalldata(CUSTOM_SIG, ['uint256'], [9n]);
      const decoder = new CalldataDecoder(makeDeps());
      const r = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: ADDR,
        calldata,
        functionSignature: null,
      });
      expect(r).toEqual({ kind: 'miss' });
    });

    it('returns miss (not throw) when proxyResolverFor throws ChainNotReadyError', async () => {
      const calldata = makeCalldata(CUSTOM_SIG, ['uint256'], [9n]);
      const deps = makeDeps({
        proxyResolverFor: vi.fn().mockImplementation(() => {
          throw new ChainNotReadyError(CHAIN);
        }),
      });
      const decoder = new CalldataDecoder(deps);
      const r = await decoder.decode({
        chainId: CHAIN,
        sourceType: SOURCE_TYPE,
        targetAddress: ADDR,
        calldata,
        functionSignature: null,
      });
      expect(r).toEqual({ kind: 'miss' });
      expect(deps.logger.info).toHaveBeenCalledWith(
        'chain_not_ready_for_proxy_resolution',
        expect.anything(),
      );
    });
  });

  describe('acceptance fixture — ≥ 48 / 50 decode', () => {
    it('decodes at least 48 of the 50 historical actions', async () => {
      const decoder = new CalldataDecoder(makeDeps());
      let decoded = 0;
      for (const entry of FIXTURE as FixtureEntry[]) {
        const r = await decoder.decode({
          chainId: CHAIN,
          sourceType: SOURCE_TYPE,
          targetAddress: ADDR,
          calldata: entry.calldata,
          functionSignature: null,
        });
        if (r.kind === 'decoded') decoded++;
      }
      expect(FIXTURE.length).toBe(50);
      expect(decoded).toBeGreaterThanOrEqual(48);
    });
  });
});
