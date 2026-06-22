/**
 * Orchestration: EVMScript hex → ordered ProposalActionInput[] (DFS pre-order).
 *
 * Pure & deterministic over (scriptHex, chainId) for a fixed registry. Action indices are
 * positional — a forwarder-registry change requires full re-derivation (AA3).
 */

import type { ProposalActionInput } from '@libs/db';
import { decodeEvmScript } from '@sources/core';
import { createForwarderRegistry, unwrapCall } from './forwarders';
import type { ForwarderRegistry } from './forwarders';

/**
 * Decode an Aragon CallsScript (spec 1) into an ordered list of proposal actions.
 *
 * @param scriptHex  Hex-encoded EVMScript (0x-prefixed or bare).
 * @param chainId    Chain id string (e.g. '0x1') attached to every leaf as targetChainId.
 * @param registry   Optional forwarder registry — defaults to the Lido mainnet registry.
 *                   Pass a custom registry for Easy Track (AC) or testing.
 * @returns          Actions in DFS pre-order (= on-chain execution order). Empty array for
 *                   empty/bare-spec-id scripts. Throws EvmScriptDecodeError for malformed input.
 */
export function toProposalActions(
  scriptHex: string,
  chainId: string,
  registry?: ForwarderRegistry,
): ProposalActionInput[] {
  const reg = registry ?? createForwarderRegistry();
  const calls = decodeEvmScript(scriptHex);
  return calls.flatMap((call) => unwrapCall(call, chainId, reg));
}
