import { Module } from '@nestjs/common';
import { ActorRoutingReadRepository, pgDb } from '@libs/db';
import { ActorRoutingService } from './actor-routing.service';
import { ActorsController } from './actors.controller';

@Module({
  controllers: [ActorsController],
  providers: [
    ActorRoutingService,
    {
      provide: ActorRoutingReadRepository,
      useFactory: () => new ActorRoutingReadRepository(pgDb),
    },
  ],
  exports: [ActorRoutingService],
})
export class ActorsModule {}
