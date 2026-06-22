/**
 * Lido forwarder registry — address-gated EVMScript unwrapping for Aragon governance.
 *
 * Known mainnet forwarders (verified against lidofinance/lido-dao and aragonOS):
 *   Agent        0x3e40D73EB977Dc6a537aF587D48316feE66E9C8c  (dominant — holds treasury + permissions)
 *   TokenManager 0xf73a1260d222f447210581DDf212D915c09a3249  (mostly vote-creation path; kept defensively)
 *   Voting       0x2e59A20f205bB85a89C53f1936454680651E618e  (the Aragon Voting contract itself)
 *
 * Selectors (keccak256 of function signature, computed via ethers Interface):
 *   forward(bytes)                       0xd948d468
 *   execute(address,uint256,bytes)       0xb61d27f6
 *
 * ## Unwrap rules (address-gated — never selector-only)
 *   forward(bytes _evmScript) on a known forwarder:
 *     _evmScript is itself a spec-1 CallsScript → recurse, splice leaf actions in place (DFS pre-order)
 *   execute(address _target, uint256 _ethValue, bytes _data) on Agent:
 *     unwrap to one leaf with targetAddress=_target, valueWei=_ethValue.toString(), calldata=_data
 *   anything else → plain opaque leaf (never throw, never drop)
 *
 * ## Depth limit
 * Max recursion depth = 8. On overflow or malformed nested bytes → degrade to an opaque leaf.
 * No cycle/visited guard (spec-1 CallsScripts are acyclic by wire-format construction).
 *
 * ## Determinism
 * unwrapCall() is pure over (call, registry) for a fixed registry. Action index stability requires
 * that registry changes trigger full re-derivation of the containing proposal's actions.
 *
 * ## Easy Track / AC reuse
 * createForwarderRegistry(extra) is extensible — pass additional forwarder addresses to handle
 * Easy Track's EVMScriptExecutor and Aragon Agent on different deployments.
 */

import { Interface, keccak256, toUtf8Bytes } from 'ethers';
import type { ProposalActionInput } from '@libs/db';
import { decodeEvmScript } from '@sources/core';
import type { EvmScriptCall } from '@sources/core';

// Selector computation — vendored minimal fragments, asserted in spec.
function selector(sig: string): string {
  return keccak256(toUtf8Bytes(sig)).slice(0, 10).toLowerCase();
}

export const FORWARD_SELECTOR = selector('forward(bytes)');
export const EXECUTE_SELECTOR = selector('execute(address,uint256,bytes)');

// Minimal ABI fragments for decoding inner calldata.
const FORWARD_IFACE = new Interface(['function forward(bytes _evmScript)']);
const EXECUTE_IFACE = new Interface([
  'function execute(address _target, uint256 _ethValue, bytes _data)',
]);

export interface ForwarderEntry {
  /** Lowercase 0x-prefixed address. */
  address: string;
  /** Which selector(s) this address responds to. */
  selectors: Set<string>;
}

export interface ForwarderRegistry {
  get(address: string): ForwarderEntry | undefined;
}

const DEFAULT_FORWARDER_ADDRESSES: readonly string[] = [
  '0x3e40d73eb977dc6a537af587d48316fee66e9c8c', // Agent
  '0xf73a1260d222f447210581ddf212d915c09a3249', // TokenManager
  '0x2e59a20f205bb85a89c53f1936454680651e618e', // Voting
];

/**
 * Build the forwarder registry.
 * Pass extra entries to extend for AC / Easy Track scenarios.
 */
export function createForwarderRegistry(
  extra?: readonly { address: string; selectors: readonly string[] }[],
): ForwarderRegistry {
  const map = new Map<string, ForwarderEntry>();

  for (const address of DEFAULT_FORWARDER_ADDRESSES) {
    const normalized = address.toLowerCase();
    map.set(normalized, { address: normalized, selectors: new Set([FORWARD_SELECTOR]) });
  }

  // Agent also supports execute — extend its entry.
  const agentAddress = '0x3e40d73eb977dc6a537af587d48316fee66e9c8c';
  const agentEntry = map.get(agentAddress);
  if (agentEntry) {
    agentEntry.selectors.add(EXECUTE_SELECTOR);
  }

  if (extra) {
    for (const { address, selectors } of extra) {
      const normalized = address.toLowerCase();
      const existing = map.get(normalized);
      if (existing) {
        for (const sel of selectors) {
          existing.selectors.add(sel.toLowerCase());
        }
      } else {
        map.set(normalized, {
          address: normalized,
          selectors: new Set(selectors.map((s) => s.toLowerCase())),
        });
      }
    }
  }

  return { get: (address) => map.get(address.toLowerCase()) };
}

const MAX_DEPTH = 8;

/**
 * Unwrap a single EvmScriptCall into an ordered list of ProposalActionInput leaves (DFS pre-order).
 *
 * - If `call.to` is a known forwarder and selector matches `forward` → recurse into nested EVMScript.
 * - If `call.to` is Agent and selector matches `execute` → unwrap to one leaf with value.
 * - Otherwise → one plain opaque leaf (valueWei='0', functionSignature=null).
 * - On recursion overflow, decode errors, or malformed args → degrade to opaque leaf, never throw.
 */
export function unwrapCall(
  call: EvmScriptCall,
  targetChainId: string,
  registry: ForwarderRegistry,
  depth = 0,
): ProposalActionInput[] {
  const entry = registry.get(call.to);
  const callSelector = call.calldata.length >= 10 ? call.calldata.slice(0, 10).toLowerCase() : '';

  if (entry && depth < MAX_DEPTH) {
    if (entry.selectors.has(FORWARD_SELECTOR) && callSelector === FORWARD_SELECTOR) {
      try {
        const decoded = FORWARD_IFACE.decodeFunctionData('forward', call.calldata);
        const nestedScript = decoded[0] as string;
        const nestedCalls = decodeEvmScript(nestedScript);
        return nestedCalls.flatMap((nestedCall) =>
          unwrapCall(nestedCall, targetChainId, registry, depth + 1),
        );
      } catch {
        // Malformed nested bytes → degrade to opaque leaf
      }
    } else if (entry.selectors.has(EXECUTE_SELECTOR) && callSelector === EXECUTE_SELECTOR) {
      try {
        const decoded = EXECUTE_IFACE.decodeFunctionData('execute', call.calldata);
        const targetAddress = (decoded[0] as string).toLowerCase();
        const ethValue = decoded[1] as bigint;
        const data = decoded[2] as string;
        return [
          {
            targetAddress,
            targetChainId,
            valueWei: ethValue.toString(),
            functionSignature: null,
            calldata: data,
          },
        ];
      } catch {
        // Malformed args → degrade to opaque leaf
      }
    }
  }

  // Depth overflow path also falls here.
  return [
    {
      targetAddress: call.to,
      targetChainId,
      valueWei: '0',
      functionSignature: null,
      calldata: call.calldata,
    },
  ];
}
