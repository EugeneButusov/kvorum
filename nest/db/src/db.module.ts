import { type DynamicModule, Module, type Type } from '@nestjs/common';
import {
  ActorRepository,
  ActorRoutingReadRepository,
  AnalyticsReadRepository,
  ArchiveDerivationRepository,
  ArchiveEventRepository,
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
  SeenLogRepository,
} from '@libs/db';

const FACTORIES = new Map<Type, () => unknown>([
  [ActorRepository, () => new ActorRepository(pgDb)],
  [ActorRoutingReadRepository, () => new ActorRoutingReadRepository(pgDb)],
  [AnalyticsReadRepository, () => new AnalyticsReadRepository(chDb, pgDb)],
  [ArchiveDerivationRepository, () => new ArchiveDerivationRepository(pgDb)],
  [ArchiveEventRepository, () => new ArchiveEventRepository(pgDb)],
  [ApiKeyRepository, () => new ApiKeyRepository(pgDb)],
  [DaoSourceRepository, () => new DaoSourceRepository(pgDb)],
  [DaoReadRepository, () => new DaoReadRepository(pgDb)],
  [DlqRepository, () => new DlqRepository(pgDb)],
  [DelegationReadRepository, () => new DelegationReadRepository(pgDb, chDb)],
  [ProposalRepository, () => new ProposalRepository(pgDb)],
  [ProposalReadRepository, () => new ProposalReadRepository(pgDb)],
  [VoteEventsProjectionReadRepository, () => new VoteEventsProjectionReadRepository(chDb)],
  [VoteEventsProjectionWriter, () => new VoteEventsProjectionWriter(chDb)],
  [VoteReadRepository, () => new VoteReadRepository(pgDb, chDb)],
  [VotingPowerSnapshotProjectionWriter, () => new VotingPowerSnapshotProjectionWriter(chDb)],
  [VotingPowerSnapshotRunRepository, () => new VotingPowerSnapshotRunRepository(pgDb)],
  [SeenLogRepository, () => new SeenLogRepository(pgDb)],
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
