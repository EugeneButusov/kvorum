import { Module } from '@nestjs/common';
import { OpsServer } from '@nest/observability';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { ActorsModule } from '../actors/actors.module';
import { AuthModule } from '../auth/auth.module';
import { CacheModule } from '../cache/cache.module';
import { DaoModule } from '../daos/dao.module';
import { DelegationsModule } from '../delegations/delegations.module';
import { HttpModule } from '../http/http.module';
import { ObservabilityModule } from '../observability/observability.module';
import { ProposalModule } from '../proposals/proposal.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { VotesModule } from '../votes/votes.module';

@Module({
  imports: [
    AuthModule,
    ActorsModule,
    CacheModule,
    DaoModule,
    DelegationsModule,
    HttpModule,
    ObservabilityModule,
    ProposalModule,
    RateLimitModule,
    VotesModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService, OpsServer],
})
export class AppModule {}
