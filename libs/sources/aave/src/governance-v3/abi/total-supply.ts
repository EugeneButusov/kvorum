import { Interface } from 'ethers';

const ERC20_INTERFACE = new Interface(['function totalSupply() view returns (uint256)']);

export function encodeTotalSupplyCall(): string {
  return ERC20_INTERFACE.encodeFunctionData('totalSupply');
}

export function decodeTotalSupplyResult(data: string): bigint {
  const [supply] = ERC20_INTERFACE.decodeFunctionResult('totalSupply', data);
  return supply as bigint;
}
