export class SameActorMergeError extends Error {
  constructor(
    public readonly primaryAddress: string,
    public readonly secondaryAddress: string,
    public readonly actorId: string,
  ) {
    super(`primary and secondary addresses resolve to the same actor: ${actorId}`);
  }
}
