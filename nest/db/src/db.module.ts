import { type DynamicModule, Module, type Type } from '@nestjs/common';
import type { Kysely } from 'kysely';
import {
  ActorRepository,
  ActorRoutingReadRepository,
  AnalyticsReadRepository,
  ArchiveDerivationRepository,
  ArchiveEventRepository,
  type AnalyticsClickHouseDatabase,
  ApiKeyRepository,
  chDb,
  DaoSourceRepository,
  DaoReadRepository,
  DlqRepository,
  DelegationReadRepository,
  pgDb,
  ProposalRepository,
  ProposalReadRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
  VoteReadRepository,
  VotingPowerSnapshotProjectionWriter,
  VotingPowerSnapshotRunRepository,
} from '@libs/db';

const FACTORIES = new Map<Type, () => unknown>([
  [ActorRepository, () => new ActorRepository(pgDb)],
  [ActorRoutingReadRepository, () => new ActorRoutingReadRepository(pgDb)],
  [
    AnalyticsReadRepository,
    () => new AnalyticsReadRepository(chDb as unknown as Kysely<AnalyticsClickHouseDatabase>, pgDb),
  ],
  [ArchiveDerivationRepository, () => new ArchiveDerivationRepository(pgDb)],
  [ArchiveEventRepository, () => new ArchiveEventRepository(pgDb)],
  [ApiKeyRepository, () => new ApiKeyRepository(pgDb)],
  [DaoSourceRepository, () => new DaoSourceRepository(pgDb)],
  [DaoReadRepository, () => new DaoReadRepository(pgDb)],
  [DlqRepository, () => new DlqRepository(pgDb)],
  [DelegationReadRepository, () => new DelegationReadRepository(pgDb, chDb as never)],
  [ProposalRepository, () => new ProposalRepository(pgDb)],
  [ProposalReadRepository, () => new ProposalReadRepository(pgDb)],
  [VoteEventsProjectionReadRepository, () => new VoteEventsProjectionReadRepository(chDb as never)],
  [VoteEventsProjectionWriter, () => new VoteEventsProjectionWriter(chDb as never)],
  [VoteReadRepository, () => new VoteReadRepository(pgDb, chDb)],
  [
    VotingPowerSnapshotProjectionWriter,
    () => new VotingPowerSnapshotProjectionWriter(chDb as never),
  ],
  [VotingPowerSnapshotRunRepository, () => new VotingPowerSnapshotRunRepository(pgDb)],
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
