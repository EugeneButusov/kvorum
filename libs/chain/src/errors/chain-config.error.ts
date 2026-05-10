export class ChainConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainConfigError';
  }
}
