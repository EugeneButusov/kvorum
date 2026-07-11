import { Module } from '@nestjs/common';
import { SOURCE_READ_EXTENSIONS, type SourceReadExtension } from '@libs/domain';
import { ActorsModule } from '@nest/actors';
import { AnalyticsModule } from '@nest/analytics';
import { AuthModule } from '@nest/auth';
import { DaoModule } from '@nest/daos';
import { DelegationsModule } from '@nest/delegations';
import { OpsServer } from '@nest/observability';
import { ProposalModule } from '@nest/proposals';
import { SOURCE_PLUGINS, SourcesModule, type SourcePlugin } from '@nest/sources';
import { VotesModule } from '@nest/votes';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { ActorProposalsController } from '../actors/actor-proposals.controller';
import { ActorRoutingService } from '../actors/actor-routing.service';
import { ActorVotesController } from '../actors/actor-votes.controller';
import { ActorsController } from '../actors/actors.controller';
import { ActorAnalyticsController } from '../analytics/actor-analytics.controller';
import { DaoAnalyticsController } from '../analytics/dao-analytics.controller';
import { AuthController } from '../auth/auth.controller';
import { CacheModule } from '../cache/cache.module';
import { DaoController } from '../daos/dao.controller';
import { DelegationsController } from '../delegations/delegations.controller';
import { DeveloperKeysController } from '../developer/developer-keys.controller';
import { HttpModule } from '../http/http.module';
import { ObservabilityModule } from '../observability/observability.module';
import { ProposalController } from '../proposals/proposal.controller';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { UsageModule } from '../usage/usage.module';
import { VotesController } from '../votes/votes.controller';

@Module({
  imports: [
    AuthModule,
    ActorsModule,
    AnalyticsModule,
    CacheModule,
    DaoModule,
    DelegationsModule,
    HttpModule,
    ObservabilityModule,
    ProposalModule,
    RateLimitModule,
    SourcesModule,
    UsageModule,
    VotesModule,
  ],
  controllers: [
    AppController,
    HealthController,
    ActorsController,
    ActorProposalsController,
    ActorVotesController,
    VotesController,
    DaoController,
    DelegationsController,
    ProposalController,
    ActorAnalyticsController,
    DaoAnalyticsController,
    AuthController,
    DeveloperKeysController,
  ],
  providers: [
    AppService,
    OpsServer,
    ActorRoutingService,
    // Source-blind: flatten each source plugin's readExtension into the collection
    // that controllers dispatch over via the @libs/domain resolve helpers.
    {
      provide: SOURCE_READ_EXTENSIONS,
      useFactory: (plugins: readonly SourcePlugin[]): SourceReadExtension[] =>
        plugins.map((p) => p.readExtension),
      inject: [SOURCE_PLUGINS],
    },
  ],
})
export class AppModule {}
