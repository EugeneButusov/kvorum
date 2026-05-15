import { Module } from '@nestjs/common';
import { OpsServer } from '@nest/observability';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { AuthModule } from '../auth/auth.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';

@Module({
  imports: [AuthModule, RateLimitModule],
  controllers: [AppController, HealthController],
  providers: [AppService, OpsServer],
})
export class AppModule {}
