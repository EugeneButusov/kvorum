import { Module } from '@nestjs/common';
import { ActorRepository, ActorRoutingReadRepository, pgDb } from '@libs/db';

@Module({
  providers: [
    { provide: ActorRepository, useFactory: () => new ActorRepository(pgDb) },
    { provide: ActorRoutingReadRepository, useFactory: () => new ActorRoutingReadRepository(pgDb) },
  ],
  exports: [ActorRepository, ActorRoutingReadRepository],
})
export class ActorsModule {}
