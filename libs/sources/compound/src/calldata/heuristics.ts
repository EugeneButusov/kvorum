import { AbiCoder, FunctionFragment } from 'ethers';

export interface HeuristicResult {
  decodedFunction: string;
  decodedArguments: Record<string, unknown>;
}

// Six well-known selectors — computed once at module load so typos surface immediately.
// Use FunctionFragment.from().selector (not ethers.id(sig).slice(0,10)) to canonicalise
// parameter names before hashing and avoid silent wrong-hash bugs.
const HEURISTICS: ReadonlyArray<{
  fragment: FunctionFragment;
  selector: string;
  decode: (calldata: string) => Record<string, unknown>;
}> = (() => {
  const coder = AbiCoder.defaultAbiCoder();

  function address(calldata: string): Record<string, unknown> {
    const [addr] = coder.decode(['address'], '0x' + calldata.slice(10));
    return { address: addr as string };
  }

  function addressUint256(calldata: string): Record<string, unknown> {
    const [addr, amount] = coder.decode(['address', 'uint256'], '0x' + calldata.slice(10));
    return { address: addr as string, amount: (amount as bigint).toString() };
  }

  function bytes32Address(calldata: string): Record<string, unknown> {
    const [role, addr] = coder.decode(['bytes32', 'address'], '0x' + calldata.slice(10));
    return { role: role as string, address: addr as string };
  }

  function noArgs(_calldata: string): Record<string, unknown> {
    return {};
  }

  const defs = [
    { sig: 'transfer(address,uint256)', decode: addressUint256 },
    { sig: 'approve(address,uint256)', decode: addressUint256 },
    { sig: 'grantRole(bytes32,address)', decode: bytes32Address },
    { sig: 'setImplementation(address)', decode: address },
    { sig: '_setPendingAdmin(address)', decode: address },
    { sig: '_acceptAdmin()', decode: noArgs },
  ] as const;

  return defs.map(({ sig, decode }) => {
    const fragment = FunctionFragment.from(sig);
    return { fragment, selector: fragment.selector.toLowerCase(), decode };
  });
})();

/** Decode calldata using the six hardcoded heuristic selectors. Returns null on no match. */
export function decodeByHeuristic(calldata: string): HeuristicResult | null {
  if (calldata.length < 10) return null;
  const selector = calldata.slice(0, 10).toLowerCase();

  for (const h of HEURISTICS) {
    if (h.selector !== selector) continue;
    try {
      const args = h.decode(calldata);
      return {
        decodedFunction: h.fragment.format('sighash'),
        decodedArguments: args,
      };
    } catch {
      return null;
    }
  }
  return null;
}

/** Exposed for regression tests — asserts no selector was mistyped. */
export const HEURISTIC_SELECTORS: ReadonlyMap<string, string> = new Map(
  HEURISTICS.map((h) => [h.fragment.format('sighash'), h.selector]),
);
