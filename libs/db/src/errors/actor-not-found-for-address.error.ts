export class ActorNotFoundForAddressError extends Error {
  constructor(public readonly address: string) {
    super(`actor not found for address: ${address}`);
  }
}
