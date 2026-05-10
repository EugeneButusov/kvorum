export class ClientStoppedError extends Error {
  readonly chainId: number;

  constructor(chainId: number) {
    super(`RPC client for chain ${chainId} has been stopped`);
    this.name = 'ClientStoppedError';
    this.chainId = chainId;
  }
}
