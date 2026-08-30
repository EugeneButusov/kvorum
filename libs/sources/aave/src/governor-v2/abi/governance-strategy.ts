import { Interface } from 'ethers';

const GOVERNANCE_STRATEGY_INTERFACE = new Interface([
  'function getTotalVotingSupplyAt(uint256 blockNumber) view returns (uint256)',
]);

export { GOVERNANCE_STRATEGY_INTERFACE };

export function encodeTotalVotingSupplyAtCall(blockNumber: bigint): string {
  return GOVERNANCE_STRATEGY_INTERFACE.encodeFunctionData('getTotalVotingSupplyAt', [blockNumber]);
}

export function decodeTotalVotingSupplyAtResult(data: string): bigint {
  const [supply] = GOVERNANCE_STRATEGY_INTERFACE.decodeFunctionResult(
    'getTotalVotingSupplyAt',
    data,
  );
  return supply as bigint;
}
