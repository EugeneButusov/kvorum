export class ActorAlreadyMergedError extends Error {
  constructor(
    public readonly address: string,
    public readonly mergedIntoActorId: string,
  ) {
    super(`actor for address ${address} is already merged (into ${mergedIntoActorId})`);
  }
}
