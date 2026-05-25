import { Module } from '@nestjs/common';
import type { Kysely } from 'kysely';
import {
  ActorRepository,
  ActorRoutingReadRepository,
  AnalyticsReadRepository,
  type AnalyticsClickHouseDatabase,
  ApiKeyRepository,
  chDb,
  DaoReadRepository,
  DelegationReadRepository,
  pgDb,
  ProposalReadRepository,
  VoteReadRepository,
} from '@libs/db';

@Module({
  providers: [
    { provide: ActorRepository, useFactory: () => new ActorRepository(pgDb) },
    { provide: ActorRoutingReadRepository, useFactory: () => new ActorRoutingReadRepository(pgDb) },
    {
      provide: AnalyticsReadRepository,
      useFactory: () =>
        new AnalyticsReadRepository(chDb as unknown as Kysely<AnalyticsClickHouseDatabase>, pgDb),
    },
    { provide: ApiKeyRepository, useFactory: () => new ApiKeyRepository(pgDb) },
    { provide: DaoReadRepository, useFactory: () => new DaoReadRepository(pgDb) },
    { provide: DelegationReadRepository, useFactory: () => new DelegationReadRepository(pgDb) },
    { provide: ProposalReadRepository, useFactory: () => new ProposalReadRepository(pgDb) },
    { provide: VoteReadRepository, useFactory: () => new VoteReadRepository(pgDb) },
  ],
  exports: [
    ActorRepository,
    ActorRoutingReadRepository,
    AnalyticsReadRepository,
    ApiKeyRepository,
    DaoReadRepository,
    DelegationReadRepository,
    ProposalReadRepository,
    VoteReadRepository,
  ],
})
export class DbModule {}
