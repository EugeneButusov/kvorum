import { Module } from '@nestjs/common';
import { LoggingModule } from '@nest/logging';
import { OpsServer } from '@nest/observability';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { AuthModule } from '../auth/auth.module';
import { CacheModule } from '../cache/cache.module';
import { DaoModule } from '../daos/dao.module';
import { HttpModule } from '../http/http.module';
import { ObservabilityModule } from '../observability/observability.module';
import { ProposalModule } from '../proposals/proposal.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';

@Module({
  imports: [
    AuthModule,
    CacheModule,
    DaoModule,
    HttpModule,
    LoggingModule,
    ObservabilityModule,
    ProposalModule,
    RateLimitModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService, OpsServer],
})
export class AppModule {}
