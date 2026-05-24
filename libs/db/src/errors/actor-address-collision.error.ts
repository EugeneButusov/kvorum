export class ActorAddressCollisionError extends Error {
  constructor(
    public readonly address: string,
    public readonly survivorActorId: string,
  ) {
    super(
      `survivor actor ${survivorActorId} already owns address ${address}; merge would violate actor_address_pkey`,
    );
  }
}
