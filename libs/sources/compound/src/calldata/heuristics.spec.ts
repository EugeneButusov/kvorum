import { AbiCoder, FunctionFragment } from 'ethers';
import { describe, expect, it } from 'vitest';
import { decodeByHeuristic, HEURISTIC_SELECTORS } from './heuristics';

const coder = AbiCoder.defaultAbiCoder();

function makeCalldata(sig: string, types: string[], values: unknown[]): string {
  const sel = FunctionFragment.from(sig).selector;
  if (types.length === 0) return sel;
  return sel + coder.encode(types, values).slice(2);
}

const ADDR_1 = '0x0000000000000000000000000000000000000001';
const AMOUNT_1 = 1n;
const ROLE_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';

const CASES: Array<{
  sig: string;
  calldata: string;
  expectedArgs: Record<string, unknown>;
}> = [
  {
    sig: 'transfer(address,uint256)',
    calldata: makeCalldata('transfer(address,uint256)', ['address', 'uint256'], [ADDR_1, AMOUNT_1]),
    expectedArgs: { address: ADDR_1, amount: '1' },
  },
  {
    sig: 'approve(address,uint256)',
    calldata: makeCalldata('approve(address,uint256)', ['address', 'uint256'], [ADDR_1, AMOUNT_1]),
    expectedArgs: { address: ADDR_1, amount: '1' },
  },
  {
    sig: 'grantRole(bytes32,address)',
    calldata: makeCalldata('grantRole(bytes32,address)', ['bytes32', 'address'], [ROLE_1, ADDR_1]),
    expectedArgs: { role: ROLE_1, address: ADDR_1 },
  },
  {
    sig: 'setImplementation(address)',
    calldata: makeCalldata('setImplementation(address)', ['address'], [ADDR_1]),
    expectedArgs: { address: ADDR_1 },
  },
  {
    sig: '_setPendingAdmin(address)',
    calldata: makeCalldata('_setPendingAdmin(address)', ['address'], [ADDR_1]),
    expectedArgs: { address: ADDR_1 },
  },
  {
    sig: '_acceptAdmin()',
    calldata: makeCalldata('_acceptAdmin()', [], []),
    expectedArgs: {},
  },
];

describe('heuristics', () => {
  describe('decodeByHeuristic', () => {
    for (const { sig, calldata, expectedArgs } of CASES) {
      it(`decodes ${sig}`, () => {
        const result = decodeByHeuristic(calldata);
        expect(result).not.toBeNull();
        expect(result!.decodedFunction).toBe(FunctionFragment.from(sig).format('sighash'));
        expect(result!.decodedArguments).toEqual(expectedArgs);
      });
    }

    it('returns null for an unknown selector', () => {
      // Use a known-absent selector (keccak32 of something unused)
      expect(decodeByHeuristic('0xfeedfeed')).toBeNull();
    });

    it('returns null for calldata shorter than 4 bytes', () => {
      expect(decodeByHeuristic('0xab')).toBeNull();
    });
  });

  describe('HEURISTIC_SELECTORS regression — no typos or swapped entries', () => {
    it('each stored selector matches FunctionFragment.from(sig).selector', () => {
      for (const [sig, storedSelector] of HEURISTIC_SELECTORS) {
        const expected = FunctionFragment.from(sig).selector.toLowerCase();
        expect(storedSelector, `selector mismatch for "${sig}"`).toBe(expected);
      }
    });

    it('contains exactly 6 entries', () => {
      expect(HEURISTIC_SELECTORS.size).toBe(6);
    });
  });
});
