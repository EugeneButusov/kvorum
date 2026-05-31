import { FunctionFragment, Interface } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import { CalldataDecoder } from './decoder';
import { ChainNotReadyError } from './errors/chain-not-ready.error';
import type { DecoderDependencies } from './types';

// ── ABI fixtures ──────────────────────────────────────────────────────────────

const TRANSFER_IFACE = new Interface(['function transfer(address to, uint256 amount)']);
const TRANSFER_FRAG = TRANSFER_IFACE.getFunction('transfer')!;
const TRANSFER_SELECTOR = TRANSFER_FRAG.selector.toLowerCase(); // 0xa9059cbb

// Valid calldata: transfer(0xaaaa...aaaa, 1)
const TRANSFER_CALLDATA =
  TRANSFER_SELECTOR +
  '000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
  '0000000000000000000000000000000000000000000000000000000000000001';

// Minimal calldata with only the selector (for event-emitted tests)
const SELECTOR_ONLY = TRANSFER_SELECTOR; // 10 chars = length 10

const CHAIN = '0x1';
const ADDR = '0x' + 'ab'.repeat(20);
const IMPL_ADDR = '0x' + 'cd'.repeat(20);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeDeps(overrides: Partial<DecoderDependencies> = {}): DecoderDependencies {
  return {
    abiCache: {
      findByAddress: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    selectorIndex: {
      lookupBySelector: vi.fn().mockResolvedValue([]),
      bulkInsert: vi.fn().mockResolvedValue(undefined),
    },
    bundledAbis: { bySelector: new Map() },
    proxyResolverFor: vi.fn().mockReturnValue({
      resolve: vi.fn().mockResolvedValue({
        implementation: null,
        reason: 'not_a_proxy',
        path: [],
        capped: false,
      }),
    }),
    etherscanClient: null,
    logger: makeLogger(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CalldataDecoder.decode — step 1: calldata sanity', () => {
  it('returns miss for non-hex calldata', async () => {
    const decoder = new CalldataDecoder(makeDeps());
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: 'not-hex-at-all',
      functionSignature: null,
    });
    expect(result).toEqual({ kind: 'miss' });
  });

  it('returns miss for odd-length hex calldata', async () => {
    const decoder = new CalldataDecoder(makeDeps());
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: '0xabc', // odd length
      functionSignature: null,
    });
    expect(result).toEqual({ kind: 'miss' });
  });

  it('returns decoded fallback() for empty calldata 0x', async () => {
    const decoder = new CalldataDecoder(makeDeps());
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: '0x',
      functionSignature: null,
    });
    expect(result).toMatchObject({
      kind: 'decoded',
      decodedFunction: 'fallback()',
      decodedArguments: {},
      source: 'empty_calldata',
    });
  });

  it('returns miss for calldata shorter than 4 bytes', async () => {
    const decoder = new CalldataDecoder(makeDeps());
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: '0xabcd', // 2 bytes — not empty but < 4
      functionSignature: null,
    });
    expect(result).toEqual({ kind: 'miss' });
  });
});

describe('CalldataDecoder.decode — step 2: heuristic decoder', () => {
  it('returns decoded from heuristic when heuristic returns a result', async () => {
    const deps = makeDeps({
      decodeByHeuristic: () => ({
        decodedFunction: 'execute()',
        decodedArguments: { targets: ['0x1'] },
      }),
    });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toMatchObject({ kind: 'decoded', source: 'heuristic' });
  });

  it('falls through to step 3 when heuristic returns null', async () => {
    const deps = makeDeps({ decodeByHeuristic: () => null });
    const decoder = new CalldataDecoder(deps);
    // No ABI, no bundled, proxy is not_a_proxy, no etherscan → miss
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toEqual({ kind: 'miss' });
  });
});

describe('CalldataDecoder.decode — step 3: event_emitted shortcut', () => {
  it('returns decoded event_emitted when length=10 and selector matches', async () => {
    const decoder = new CalldataDecoder(makeDeps());
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: SELECTOR_ONLY,
      functionSignature: 'transfer(address,uint256)',
    });
    expect(result).toMatchObject({
      kind: 'decoded',
      decodedArguments: {},
      source: 'event_emitted',
    });
  });

  it('logs mismatch and falls through when selector does not match functionSignature', async () => {
    const deps = makeDeps();
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: '0x00000000', // different selector
      functionSignature: 'transfer(address,uint256)',
    });
    expect(result).toEqual({ kind: 'miss' });
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'event_emitted_selector_mismatch',
      expect.anything(),
    );
  });

  it('falls through when functionSignature is malformed', async () => {
    const decoder = new CalldataDecoder(makeDeps());
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: '0x00000000',
      functionSignature: 'not!!!valid())',
    });
    expect(result).toEqual({ kind: 'miss' });
  });
});

describe('CalldataDecoder — step 4: abi_cache', () => {
  it('returns decoded abi_cache when address has cached ABI and selector matches', async () => {
    const abi = JSON.parse(TRANSFER_IFACE.formatJson()) as unknown[];
    const deps = makeDeps({
      abiCache: {
        findByAddress: vi.fn().mockResolvedValue({ abi }),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toMatchObject({ kind: 'decoded', source: 'abi_cache' });
    expect(
      (result as { decodedArguments: Record<string, unknown> }).decodedArguments,
    ).toHaveProperty('to');
    expect(
      (result as { decodedArguments: Record<string, unknown> }).decodedArguments,
    ).toHaveProperty('amount');
  });

  it('falls through to step 5 when cached ABI has no matching selector', async () => {
    // ABI with an event only — no function with the transfer selector
    const abi = [{ type: 'event', name: 'Approval', inputs: [] }];
    const deps = makeDeps({
      abiCache: {
        findByAddress: vi.fn().mockResolvedValue({ abi }),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    // No bundled, not_a_proxy, no etherscan → miss
    expect(result).toEqual({ kind: 'miss' });
  });

  it('falls through and logs abi_cache_selector_miss when decodedArguments throws', async () => {
    // ABI has the transfer function but calldata is only the selector (missing argument bytes)
    // → decodedArguments will throw → catch → 'abi_cache_selector_miss'
    const abi = JSON.parse(TRANSFER_IFACE.formatJson()) as unknown[];
    const deps = makeDeps({
      abiCache: {
        findByAddress: vi.fn().mockResolvedValue({ abi }),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: SELECTOR_ONLY, // no argument bytes → decodeFunctionData throws
      functionSignature: null, // skip step 3 (event_emitted) so step 4 runs
    });
    expect(result).toEqual({ kind: 'miss' });
    expect(deps.logger.info).toHaveBeenCalledWith('abi_cache_selector_miss', expect.anything());
  });
});

describe('CalldataDecoder — step 5: bundled ABI library', () => {
  it('returns decoded bundled_library when selector is in bundled ABIs', async () => {
    const deps = makeDeps({
      bundledAbis: {
        bySelector: new Map([
          [
            TRANSFER_SELECTOR,
            [{ iface: TRANSFER_IFACE, fragment: TRANSFER_FRAG, sourceName: 'erc20' }],
          ],
        ]),
      },
    });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toMatchObject({ kind: 'decoded', source: 'bundled_library' });
    expect(deps.abiCache.upsert).toHaveBeenCalledTimes(1);
  });

  it('logs collision and decodes from first candidate when multiple candidates share a selector', async () => {
    const frag2 = FunctionFragment.from('transfer(address,uint256)');
    const iface2 = new Interface(['function transfer(address to, uint256 amount)']);
    const deps = makeDeps({
      bundledAbis: {
        bySelector: new Map([
          [
            TRANSFER_SELECTOR,
            [
              { iface: TRANSFER_IFACE, fragment: TRANSFER_FRAG, sourceName: 'erc20' },
              { iface: iface2, fragment: frag2, sourceName: 'erc20-v2' },
            ],
          ],
        ]),
      },
    });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toMatchObject({ kind: 'decoded', source: 'bundled_library' });
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'selector_collision_in_library',
      expect.anything(),
    );
  });

  it('falls through to step 6 when all bundled candidates fail to decode calldata', async () => {
    // SELECTOR_ONLY has no argument bytes → decodeFunctionData throws for transfer(addr,uint256)
    const deps = makeDeps({
      bundledAbis: {
        bySelector: new Map([
          [
            TRANSFER_SELECTOR,
            [{ iface: TRANSFER_IFACE, fragment: TRANSFER_FRAG, sourceName: 'erc20' }],
          ],
        ]),
      },
    });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: SELECTOR_ONLY, // only 4-byte selector, missing argument bytes → decode fails
      functionSignature: null,
    });
    // All bundled fail → step 6: proxyResolver returns not_a_proxy → step 7: no etherscan → miss
    expect(result).toEqual({ kind: 'miss' });
  });
});

describe('CalldataDecoder — step 6: proxy resolution', () => {
  it('returns miss when proxyResolverFor throws ChainNotReadyError', async () => {
    const deps = makeDeps({
      proxyResolverFor: vi.fn().mockImplementation(() => {
        throw new ChainNotReadyError('0x1');
      }),
    });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toEqual({ kind: 'miss' });
    expect(deps.logger.info).toHaveBeenCalledWith(
      'chain_not_ready_for_proxy_resolution',
      expect.anything(),
    );
  });

  it('returns decoded proxy_resolved with dual upsert when impl cached after recursion', async () => {
    const abi = JSON.parse(TRANSFER_IFACE.formatJson()) as unknown[];
    const deps = makeDeps({
      abiCache: {
        findByAddress: vi.fn().mockImplementation((_chain: string, addr: string) => {
          // Both the first call (recursive: look up IMPL_ADDR) and second call (parent: fetch implCached)
          // return the ABI for IMPL_ADDR only
          if (addr === IMPL_ADDR.toLowerCase()) return Promise.resolve({ abi });
          return Promise.resolve(undefined);
        }),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
      proxyResolverFor: vi.fn().mockReturnValue({
        resolve: vi.fn().mockResolvedValue({
          implementation: IMPL_ADDR,
          reason: 'resolved',
          path: [
            {
              proxyAddress: ADDR.toLowerCase(),
              slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
              kind: 'eip1967',
            },
          ],
          capped: false,
        }),
      }),
    });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toMatchObject({ kind: 'decoded', source: 'proxy_resolved' });
    // dual upsert: once for ADDR (proxy), once for IMPL_ADDR (impl)
    expect(deps.abiCache.upsert).toHaveBeenCalledTimes(2);
  });

  it('returns decoded proxy_resolved with no upsert when impl ABI is not in cache after recursion', async () => {
    // Outer call: abiCache always returns undefined
    // Recursive call on IMPL_ADDR: bundled ABI decodes it
    const deps = makeDeps({
      bundledAbis: {
        bySelector: new Map([
          [
            TRANSFER_SELECTOR,
            [{ iface: TRANSFER_IFACE, fragment: TRANSFER_FRAG, sourceName: 'erc20' }],
          ],
        ]),
      },
      abiCache: {
        findByAddress: vi.fn().mockResolvedValue(undefined), // always miss — no dual upsert
        upsert: vi.fn().mockResolvedValue(undefined),
      },
      proxyResolverFor: vi.fn().mockReturnValue({
        resolve: vi.fn().mockResolvedValue({
          implementation: IMPL_ADDR,
          reason: 'capped',
          path: [{ proxyAddress: ADDR.toLowerCase(), slot: '0x...', kind: 'eip1967' }],
          capped: true,
        }),
      }),
    });
    const decoder = new CalldataDecoder(deps);

    // First call: outer with ADDR — bundled will decode for ADDR too, but abiCache miss means proxy runs
    // Hmm: outer call → step 5 bundled hit for TRANSFER_SELECTOR → decoded(bundled_library) before reaching proxy
    // We need the outer call to NOT match bundled. Use a different calldata.

    // Actually to avoid the outer call hitting bundled, use a selector NOT in bundledAbis for outer call.
    // But then the recursive call also uses TRANSFER_SELECTOR and bundled WOULD match.
    // The recursive call uses the same calldata passed down, so if outer calldata != TRANSFER_SELECTOR prefix, recursive also won't match bundled.

    // Cleanest approach: use abiCache to decode in the recursive call (different findByAddress behavior per call number)
    let callNumber = 0;
    deps.abiCache.findByAddress = vi.fn().mockImplementation((_chain: string, addr: string) => {
      callNumber++;
      // Call 1: outer call, abiCache for ADDR → miss
      // Call 2: recursive call, abiCache for IMPL_ADDR → hit (triggers decoded)
      // Call 3: parent post-recursion, abiCache for IMPL_ADDR → miss (no upsert)
      if (addr === IMPL_ADDR.toLowerCase() && callNumber === 2) {
        return Promise.resolve({ abi: JSON.parse(TRANSFER_IFACE.formatJson()) });
      }
      return Promise.resolve(undefined);
    });

    // Now remove bundled so outer doesn't match it
    deps.bundledAbis = { bySelector: new Map() };

    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toMatchObject({ kind: 'decoded', source: 'proxy_resolved' });
    // No dual upsert since implCached was undefined on the second lookup
    expect(deps.abiCache.upsert).not.toHaveBeenCalled();
  });

  it('falls through to step 7 when proxy resolves but impl decode returns miss', async () => {
    const deps = makeDeps({
      proxyResolverFor: vi.fn().mockReturnValue({
        resolve: vi.fn().mockResolvedValue({
          implementation: IMPL_ADDR,
          reason: 'resolved',
          path: [],
          capped: false,
        }),
      }),
    });
    // No ABI anywhere → impl decode will be miss → falls through to step 7 (etherscan null) → miss
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toEqual({ kind: 'miss' });
  });
});

describe('CalldataDecoder — step 7: etherscan', () => {
  it('returns decoded etherscan when Etherscan returns ABI with matching selector', async () => {
    const abi = JSON.parse(TRANSFER_IFACE.formatJson()) as unknown[];
    const deps = makeDeps({
      etherscanClient: {
        fetchAbi: vi.fn().mockResolvedValue(abi),
      },
    });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toMatchObject({ kind: 'decoded', source: 'etherscan' });
    expect(deps.abiCache.upsert).toHaveBeenCalled();
    expect(deps.selectorIndex.bulkInsert).toHaveBeenCalled();
  });

  it('falls through to step 8 when Etherscan returns ABI but selector is absent', async () => {
    // ABI has only an event, no function matching TRANSFER_SELECTOR
    const abi = [{ type: 'event', name: 'Transfer', inputs: [{ type: 'address', name: 'from' }] }];
    const deps = makeDeps({ etherscanClient: { fetchAbi: vi.fn().mockResolvedValue(abi) } });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toEqual({ kind: 'miss' });
  });

  it('falls through to step 8 when Etherscan returns null', async () => {
    const deps = makeDeps({ etherscanClient: { fetchAbi: vi.fn().mockResolvedValue(null) } });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toEqual({ kind: 'miss' });
  });

  it('falls through and logs when Etherscan fetchAbi throws', async () => {
    const deps = makeDeps({
      etherscanClient: { fetchAbi: vi.fn().mockRejectedValue(new Error('network error')) },
    });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toEqual({ kind: 'miss' });
    expect(deps.logger.info).toHaveBeenCalledWith('etherscan_fetch_failed', expect.anything());
  });
});

describe('CalldataDecoder — step 8: selector_index', () => {
  it('returns partial when selector_index has a signature guess', async () => {
    const deps = makeDeps({
      selectorIndex: {
        lookupBySelector: vi.fn().mockResolvedValue([{ signature: 'transfer(address,uint256)' }]),
        bulkInsert: vi.fn(),
      },
    });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toMatchObject({
      kind: 'partial',
      decodedFunction: null,
      functionSignatureGuess: 'transfer(address,uint256)',
      source: 'selector_index',
    });
  });
});

describe('CalldataDecoder — step 9: miss', () => {
  it('returns miss when no source produces a result', async () => {
    const decoder = new CalldataDecoder(makeDeps());
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result).toEqual({ kind: 'miss' });
  });
});

describe('CalldataDecoder — serialise helper (via decoded arguments)', () => {
  it('serialises BigInt values to decimal strings in decoded arguments', async () => {
    const abi = JSON.parse(TRANSFER_IFACE.formatJson()) as unknown[];
    const deps = makeDeps({
      abiCache: {
        findByAddress: vi.fn().mockResolvedValue({ abi }),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    });
    const decoder = new CalldataDecoder(deps);
    const result = await decoder.decode({
      chainId: CHAIN,
      targetAddress: ADDR,
      calldata: TRANSFER_CALLDATA,
      functionSignature: null,
    });
    expect(result.kind).toBe('decoded');
    if (result.kind === 'decoded') {
      // 'amount' is uint256 → decoded as BigInt → serialised to string '1'
      expect(typeof result.decodedArguments['amount']).toBe('string');
      expect(result.decodedArguments['amount']).toBe('1');
    }
  });
});
