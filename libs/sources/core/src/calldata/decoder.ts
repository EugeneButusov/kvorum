import { AbiCoder, Interface, FunctionFragment } from 'ethers';
import type { LoadedAbiLibrary } from './abi-library';
import type { DecodeResult, DecoderDependencies } from './types';

const HEX_RE = /^0x[0-9a-f]*$/i;

/** Serialise BigInt values to decimal strings so the result is JSON-safe. */
function serialise(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serialise);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, serialise(v)]));
  }
  return value;
}

/** Map a decoded parameter tuple to `{ paramName | index: value }`, BigInt-safe. */
function namedArgs(fragment: FunctionFragment, raw: ArrayLike<unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (let i = 0; i < fragment.inputs.length; i++) {
    result[fragment.inputs[i]!.name || String(i)] = serialise(raw[i]);
  }
  return result;
}

function decodedArguments(
  iface: Interface,
  fragment: FunctionFragment,
  calldata: string,
): Record<string, unknown> {
  return namedArgs(fragment, iface.decodeFunctionData(fragment, calldata));
}

export interface DecodeInput {
  chainId: string;
  sourceType: string;
  targetAddress: string;
  calldata: string;
  /** Compound's ProposalCreated.signatures[i]; may be empty string or null. */
  functionSignature: string | null;
}

export class CalldataDecoder {
  constructor(private readonly deps: DecoderDependencies) {}

  async decode(input: DecodeInput): Promise<DecodeResult> {
    const { chainId, calldata, functionSignature } = input;
    const targetAddress = input.targetAddress.toLowerCase();
    const library = this.deps.bundledAbisFor(input.sourceType);

    // ── Step 1: calldata sanity ────────────────────────────────────────────────
    if (!HEX_RE.test(calldata) || calldata.length % 2 !== 0) {
      this.deps.logger.error('calldata_malformed', { targetAddress, calldata });
      return { kind: 'miss' };
    }

    // ── Step 2: function-signature-driven decode ──────────────────────────────
    // Compound/Aave Bravo-style governors carry the function in ProposalCreated.signatures[i]
    // and store `calldata` as the ABI-encoded ARGUMENTS ONLY (the Timelock re-prepends the
    // 4-byte selector at execution). When a signature is present it is authoritative — the
    // selector-based path below would read the first 4 bytes of the *arguments* as a bogus
    // selector and always miss. This also subsumes the emitted bare-selector (R3) form.
    if (functionSignature) {
      const bySignature = this.decodeFromSignature(functionSignature, calldata, targetAddress);
      if (bySignature !== null) return bySignature;
    }

    // ── Step 3: empty / too-short calldata ─────────────────────────────────────
    if (calldata === '0x') {
      return {
        kind: 'decoded',
        decodedFunction: 'fallback()',
        decodedArguments: {},
        source: 'empty_calldata',
      };
    }
    if (calldata.length < 10) {
      // Less than 4 bytes — not a valid function call and not empty
      return { kind: 'miss' };
    }

    // ── Step 4: heuristic decoder ─────────────────────────────────────────────
    if (this.deps.decodeByHeuristic) {
      const heuristic = this.deps.decodeByHeuristic(calldata);
      if (heuristic !== null) {
        return {
          kind: 'decoded',
          decodedFunction: heuristic.decodedFunction,
          decodedArguments: heuristic.decodedArguments,
          source: 'heuristic',
        };
      }
    }

    return this.decodeWithAddress(targetAddress, chainId, calldata, functionSignature, library);
  }

  /**
   * Decode using an event-provided function signature. Handles two on-chain encodings:
   *  - **bare selector** (`calldata` is exactly the 4-byte selector) → decoded with no args (R3);
   *  - **split encoding** (`calldata` is the ABI-encoded arguments only, no selector prefix) →
   *    decode the args against the signature. This is the Compound/Aave Bravo/Alpha case.
   * Returns null (fall through to address-based decoding) on a malformed signature, a bare
   * selector that doesn't match, or args that don't fit the signature.
   */
  private decodeFromSignature(
    functionSignature: string,
    calldata: string,
    targetAddress: string,
  ): DecodeResult | null {
    let fragment: FunctionFragment;
    try {
      fragment = FunctionFragment.from(functionSignature);
    } catch {
      return null; // malformed signature — fall through
    }

    // Bare-selector form: the wire calldata is just the selector emitted alongside the signature.
    if (calldata.length === 10) {
      if (calldata.toLowerCase() === fragment.selector.toLowerCase()) {
        return {
          kind: 'decoded',
          decodedFunction: fragment.format('sighash'),
          decodedArguments: {},
          source: 'event_emitted',
        };
      }
      this.deps.logger.warn('event_emitted_selector_mismatch', {
        targetAddress,
        functionSignature,
        calldata,
      });
      return null;
    }

    try {
      // A full-input calldata (selector + args) that still carries a signature: decode normally
      // rather than treating the leading selector bytes as an argument.
      if (calldata.slice(0, 10).toLowerCase() === fragment.selector.toLowerCase()) {
        return {
          kind: 'decoded',
          decodedFunction: fragment.format('sighash'),
          decodedArguments: decodedArguments(new Interface([fragment]), fragment, calldata),
          source: 'function_signature',
        };
      }
      // Split-encoding form: calldata is the ABI-encoded arguments only (no selector prefix).
      const args =
        fragment.inputs.length === 0
          ? {}
          : namedArgs(fragment, AbiCoder.defaultAbiCoder().decode(fragment.inputs, calldata));
      return {
        kind: 'decoded',
        decodedFunction: fragment.format('sighash'),
        decodedArguments: args,
        source: 'function_signature',
      };
    } catch {
      return null; // args don't fit the signature — fall through
    }
  }

  /** Steps 4–9, recursive on proxy resolution. */
  private async decodeWithAddress(
    address: string,
    chainId: string,
    calldata: string,
    functionSignature: string | null,
    library: LoadedAbiLibrary,
    isProxyRecurse = false,
  ): Promise<DecodeResult> {
    const selector = calldata.slice(0, 10).toLowerCase();

    // ── Step 4: abi_cache lookup ──────────────────────────────────────────────
    const cached = await this.deps.abiCache.findByAddress(chainId, address);
    if (cached !== undefined) {
      try {
        const iface = new Interface(cached.abi as never[]);
        const fragment = iface.getFunction(selector);
        if (fragment !== null) {
          const args = decodedArguments(iface, fragment as FunctionFragment, calldata);
          return {
            kind: 'decoded',
            decodedFunction: (fragment as FunctionFragment).format('sighash'),
            decodedArguments: args,
            source: isProxyRecurse ? 'proxy_resolved' : 'abi_cache',
          };
        }
      } catch {
        this.deps.logger.info('abi_cache_selector_miss', { address, selector });
      }
    }

    // ── Step 5: bundled ABI library ───────────────────────────────────────────
    const bucket = library.bySelector.get(selector);
    if (bucket !== undefined && bucket.length > 0) {
      if (bucket.length > 1) {
        this.deps.logger.warn('selector_collision_in_library', {
          selector,
          candidates: bucket.map((e) => `${e.sourceName}:${e.fragment.format('sighash')}`),
        });
      }
      for (const entry of bucket) {
        try {
          const args = decodedArguments(entry.iface, entry.fragment, calldata);
          await this.deps.abiCache.upsert({
            chain_id: chainId,
            address,
            abi: JSON.parse(entry.iface.formatJson()) as unknown,
            source: 'bundled_library',
            fetched_at: new Date(),
            implementation_chain: null,
          });
          return {
            kind: 'decoded',
            decodedFunction: entry.fragment.format('sighash'),
            decodedArguments: args,
            source: isProxyRecurse ? 'proxy_resolved' : 'bundled_library',
          };
        } catch {
          // Selector matched but calldata shape didn't — try next candidate (collision).
        }
      }
    }

    // ── Step 6: proxy resolution ──────────────────────────────────────────────
    if (!isProxyRecurse) {
      let proxyResolver;
      try {
        proxyResolver = this.deps.proxyResolverFor(chainId);
      } catch {
        // ChainNotReadyError — treat as miss; worker will retry.
        this.deps.logger.info('chain_not_ready_for_proxy_resolution', { chainId });
        return { kind: 'miss' };
      }

      const resolution = await proxyResolver.resolve(address);
      if (
        resolution.implementation !== null &&
        (resolution.reason === 'resolved' || resolution.reason === 'capped')
      ) {
        const implResult = await this.decodeWithAddress(
          resolution.implementation,
          chainId,
          calldata,
          functionSignature,
          library,
          true,
        );

        if (implResult.kind === 'decoded') {
          const implCached = await this.deps.abiCache.findByAddress(
            chainId,
            resolution.implementation,
          );
          const implAbi = implCached?.abi ?? null;

          if (implAbi !== null) {
            const implChain = resolution.path.map((s) => s.proxyAddress);
            await this.deps.abiCache.upsert({
              chain_id: chainId,
              address,
              abi: implAbi,
              source: 'proxy_resolved',
              fetched_at: new Date(),
              implementation_chain: implChain,
            });
            await this.deps.abiCache.upsert({
              chain_id: chainId,
              address: resolution.implementation,
              abi: implAbi,
              source: 'proxy_resolved',
              fetched_at: new Date(),
              implementation_chain: null,
            });
          }

          return implResult;
        }
      }
    }

    // ── Step 7: Etherscan enrichment (off by default) ─────────────────────────
    if (this.deps.etherscanClient !== null) {
      try {
        // 7a — the target's own verified ABI.
        const direct = await this.enrichFromEtherscan(address, chainId);
        if (direct !== null) {
          const fragment = direct.iface.getFunction(selector);
          if (fragment !== null) {
            return {
              kind: 'decoded',
              decodedFunction: (fragment as FunctionFragment).format('sighash'),
              decodedArguments: decodedArguments(
                direct.iface,
                fragment as FunctionFragment,
                calldata,
              ),
              source: 'etherscan',
            };
          }
        }

        // 7b — proxy → implementation via getsourcecode. Etherscan recognises proxies the RPC
        // slot-checker (Step 6) cannot, notably non-standard ones like Compound's Unitroller, so
        // when the target's own ABI lacks the selector we decode against its implementation's ABI.
        if (!isProxyRecurse) {
          const impl = await this.deps.etherscanClient.fetchImplementation(chainId, address);
          if (impl !== null && impl !== address) {
            const viaImpl = await this.enrichFromEtherscan(impl, chainId);
            if (viaImpl !== null) {
              const fragment = viaImpl.iface.getFunction(selector);
              if (fragment !== null) {
                // Cache the implementation ABI against the proxy address so future decodes of this
                // proxy hit the cache (Step 4) instead of re-resolving.
                await this.deps.abiCache.upsert({
                  chain_id: chainId,
                  address,
                  abi: viaImpl.abi,
                  source: 'proxy_resolved',
                  fetched_at: new Date(),
                  implementation_chain: [impl],
                });
                return {
                  kind: 'decoded',
                  decodedFunction: (fragment as FunctionFragment).format('sighash'),
                  decodedArguments: decodedArguments(
                    viaImpl.iface,
                    fragment as FunctionFragment,
                    calldata,
                  ),
                  source: 'proxy_resolved',
                };
              }
            }
          }
        }
      } catch (err) {
        this.deps.logger.info('etherscan_fetch_failed', { address, error: String(err) });
      }
    }

    // ── Step 8: selector_index consultation ───────────────────────────────────
    const indexRows = await this.deps.selectorIndex.lookupBySelector(selector);
    if (indexRows.length > 0) {
      return {
        kind: 'partial',
        decodedFunction: null,
        functionSignatureGuess: indexRows[0]!.signature,
        source: 'selector_index',
      };
    }

    // ── Step 9: miss ──────────────────────────────────────────────────────────
    return { kind: 'miss' };
  }

  /**
   * Fetch a verified ABI from Etherscan for one address, warm `abi_cache` + `selector_index`, and
   * return an ethers Interface over it. Returns null when the address has no usable verified ABI
   * (unverified, rate-limited past retries, or empty). Callers match the selector against the Interface.
   */
  private async enrichFromEtherscan(
    address: string,
    chainId: string,
  ): Promise<{ iface: Interface; abi: unknown } | null> {
    const client = this.deps.etherscanClient;
    if (client === null) return null;

    const abi = await client.fetchAbi(chainId, address);
    if (abi === null || abi.length === 0) return null;

    const iface = new Interface(abi as never[]);
    const selectorRows = iface.fragments
      .filter((f) => f.type === 'function')
      .map((f) => {
        const fn = f as FunctionFragment;
        return {
          selector: fn.selector.toLowerCase(),
          signature: fn.format('sighash'),
          source: 'etherscan',
          imported_at: new Date(),
        };
      });
    if (selectorRows.length > 0) {
      await this.deps.selectorIndex.bulkInsert(selectorRows);
    }

    await this.deps.abiCache.upsert({
      chain_id: chainId,
      address,
      abi: abi as unknown,
      source: 'etherscan',
      fetched_at: new Date(),
      implementation_chain: null,
    });

    return { iface, abi };
  }
}
