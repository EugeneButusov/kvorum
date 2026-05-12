export class ClientStoppedError extends Error {
  readonly chainId: string;

  constructor(chainId: string) {
    super(`RPC client for chain ${chainId} has been stopped`);
    this.name = 'ClientStoppedError';
    this.chainId = chainId;
  }
}
