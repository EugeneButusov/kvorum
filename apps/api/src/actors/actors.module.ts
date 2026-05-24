import { Module } from '@nestjs/common';
import { ActorRoutingReadRepository, pgDb } from '@libs/db';
import { ActorsController } from './actors.controller';
import { ActorRoutingService } from './actor-routing.service';

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
