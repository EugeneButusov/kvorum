export class ChainNotReadyError extends Error {
  constructor(chainId: string) {
    super(`Chain context not ready for chainId: ${chainId}`);
    this.name = 'ChainNotReadyError';
  }
}
