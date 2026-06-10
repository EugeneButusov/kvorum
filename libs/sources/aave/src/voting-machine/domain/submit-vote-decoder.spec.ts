import { Interface } from 'ethers';
import { describe, expect, it } from 'vitest';
import { decodeSubmitVoteCalldata, decodeSubmitVoteProofs } from './submit-vote-decoder';

const iface = new Interface([
  'function submitVote(uint256 proposalId, bool support, tuple(address underlyingAsset, uint128 slot, bytes proof)[] votingBalanceProofs)',
  'function submitVoteAsRepresentative(uint256 proposalId, bool support, address voter, bytes proofOfRepresentation, tuple(address underlyingAsset, uint128 slot, bytes proof)[] votingBalanceProofs)',
]);

describe('decodeSubmitVoteCalldata', () => {
  it('extracts submitted governance assets from submitVote calldata', () => {
    const calldata = iface.encodeFunctionData('submitVote', [
      42n,
      true,
      [
        { underlyingAsset: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', slot: 0, proof: '0x1234' },
        { underlyingAsset: '0x4da27a545c0c5B758a6BA100e3a049001de870f5', slot: 1, proof: '0xabcd' },
      ],
    ]);

    expect(decodeSubmitVoteCalldata(calldata)).toEqual([
      '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
      '0x4da27a545c0c5b758a6ba100e3a049001de870f5',
    ]);

    expect(decodeSubmitVoteProofs(calldata)).toEqual([
      {
        underlyingAsset: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
        slot: 0n,
      },
      {
        underlyingAsset: '0x4da27a545c0c5b758a6ba100e3a049001de870f5',
        slot: 1n,
      },
    ]);
  });

  it('throws on calldata that does not match any known submitVote function', () => {
    expect(() => decodeSubmitVoteCalldata('0xdeadbeef00000000')).toThrow(
      'unsupported Aave submitVote calldata',
    );
    expect(() => decodeSubmitVoteProofs('0xdeadbeef00000000')).toThrow(
      'unsupported Aave submitVote calldata',
    );
  });

  it('supports representative vote submissions too', () => {
    const calldata = iface.encodeFunctionData('submitVoteAsRepresentative', [
      42n,
      false,
      '0x00000000000000000000000000000000000000ab',
      '0x01',
      [{ underlyingAsset: '0xA700b4eB416Be35b2911fd5Dee80678ff64fF6C9', slot: 7, proof: '0xbeef' }],
    ]);

    expect(decodeSubmitVoteCalldata(calldata)).toEqual([
      '0xa700b4eb416be35b2911fd5dee80678ff64ff6c9',
    ]);
  });
});
