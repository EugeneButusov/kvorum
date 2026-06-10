import { Interface } from 'ethers';

const SUBMIT_VOTE_INTERFACE = new Interface([
  'function submitVote(uint256 proposalId, bool support, tuple(address underlyingAsset, uint128 slot, bytes proof)[] votingBalanceProofs)',
  'function submitVoteBySignature(uint256 proposalId, address voter, bool support, tuple(address underlyingAsset, uint128 slot, bytes proof)[] votingBalanceProofs, uint8 v, bytes32 r, bytes32 s)',
  'function submitVoteAsRepresentative(uint256 proposalId, bool support, address voter, bytes proofOfRepresentation, tuple(address underlyingAsset, uint128 slot, bytes proof)[] votingBalanceProofs)',
  'function submitVoteAsRepresentativeBySignature(uint256 proposalId, address voter, address representative, bool support, bytes proofOfRepresentation, tuple(address underlyingAsset, uint128 slot, bytes proof)[] votingBalanceProofs, tuple(uint8 v, bytes32 r, bytes32 s) signatureParams)',
]);

interface VotingBalanceProofLike {
  underlyingAsset: string;
  slot: bigint;
}

export interface SubmittedVotingBalanceProof {
  underlyingAsset: string;
  slot: bigint;
}

export function decodeSubmitVoteProofs(calldata: string): SubmittedVotingBalanceProof[] {
  const parsed = SUBMIT_VOTE_INTERFACE.parseTransaction({ data: calldata });
  if (parsed == null) {
    throw new Error('unsupported Aave submitVote calldata');
  }

  const proofs = parsed.args['votingBalanceProofs'] as VotingBalanceProofLike[] | undefined;
  if (proofs == null) {
    throw new Error(`submitVote calldata missing votingBalanceProofs for ${parsed.name}`);
  }

  return proofs.map((proof) => ({
    underlyingAsset: proof.underlyingAsset.toLowerCase(),
    slot: proof.slot,
  }));
}

export function decodeSubmitVoteCalldata(calldata: string): string[] {
  return decodeSubmitVoteProofs(calldata).map((proof) => proof.underlyingAsset);
}
