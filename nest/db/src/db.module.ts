import { type DynamicModule, Module, type Type } from '@nestjs/common';
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

const FACTORIES = new Map<Type, () => unknown>([
  [ActorRepository, () => new ActorRepository(pgDb)],
  [ActorRoutingReadRepository, () => new ActorRoutingReadRepository(pgDb)],
  [
    AnalyticsReadRepository,
    () => new AnalyticsReadRepository(chDb as unknown as Kysely<AnalyticsClickHouseDatabase>, pgDb),
  ],
  [ApiKeyRepository, () => new ApiKeyRepository(pgDb)],
  [DaoReadRepository, () => new DaoReadRepository(pgDb)],
  [DelegationReadRepository, () => new DelegationReadRepository(pgDb, chDb as never)],
  [ProposalReadRepository, () => new ProposalReadRepository(pgDb)],
  [VoteReadRepository, () => new VoteReadRepository(pgDb, chDb as never)],
]);

@Module({})
export class DbModule {
  static forFeature(repositories: Type[]): DynamicModule {
    const providers = repositories.map((repo) => ({
      provide: repo,
      useFactory: FACTORIES.get(repo)!,
    }));
    return { module: DbModule, providers, exports: repositories };
  }
}
