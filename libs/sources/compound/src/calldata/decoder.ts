import { Interface, FunctionFragment } from 'ethers';
import { decodeByHeuristic } from './heuristics';
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

function decodedArguments(
  iface: Interface,
  fragment: FunctionFragment,
  calldata: string,
): Record<string, unknown> {
  const raw = iface.decodeFunctionData(fragment, calldata);
  const result: Record<string, unknown> = {};
  for (let i = 0; i < fragment.inputs.length; i++) {
    result[fragment.inputs[i]!.name || String(i)] = serialise(raw[i]);
  }
  return result;
}

export interface DecodeInput {
  chainId: string;
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

    // ── Step 1: calldata sanity / empty-calldata fallback ──────────────────────
    if (!HEX_RE.test(calldata) || calldata.length % 2 !== 0) {
      this.deps.logger.error('calldata_malformed', { targetAddress, calldata });
      return { kind: 'miss' };
    }
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

    // ── Step 2: heuristic decoder ─────────────────────────────────────────────
    const heuristic = decodeByHeuristic(calldata);
    if (heuristic !== null) {
      return {
        kind: 'decoded',
        decodedFunction: heuristic.decodedFunction,
        decodedArguments: heuristic.decodedArguments,
        source: 'heuristic',
      };
    }

    // ── Step 3: event_emitted shortcut (R3) ───────────────────────────────────
    // Fires only when the calldata is selector-only (no args) and the event
    // provided a function_signature we can verify.
    if (calldata.length === 10 && functionSignature) {
      try {
        const fragment = FunctionFragment.from(functionSignature);
        if (fragment.selector.toLowerCase() === calldata.slice(0, 10).toLowerCase()) {
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
      } catch {
        // Malformed function_signature — fall through
      }
    }

    return this.decodeWithAddress(targetAddress, chainId, calldata, functionSignature);
  }

  /** Steps 4–9, recursive on proxy resolution. */
  private async decodeWithAddress(
    address: string,
    chainId: string,
    calldata: string,
    functionSignature: string | null,
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
    const bucket = this.deps.bundledAbis.bySelector.get(selector);
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
          // Persist ABI to cache so future calls skip the library scan.
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
          true,
        );

        if (implResult.kind === 'decoded') {
          // R11: persist abi_cache for BOTH proxy and impl.
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
            // Impl row without implementation_chain (direct calls skip proxy resolution).
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
        const abi = await this.deps.etherscanClient.fetchAbi(chainId, address);
        if (abi !== null && abi.length > 0) {
          const iface = new Interface(abi as never[]);
          // Populate selector_index from each function fragment.
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

          const fragment = iface.getFunction(selector);
          if (fragment !== null) {
            const args = decodedArguments(iface, fragment as FunctionFragment, calldata);
            return {
              kind: 'decoded',
              decodedFunction: (fragment as FunctionFragment).format('sighash'),
              decodedArguments: args,
              source: 'etherscan',
            };
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
}
