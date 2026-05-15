import { Module } from '@nestjs/common';
import { OpsServer } from '@nest/observability';
import { AuthModule } from '../auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AppController, HealthController],
  providers: [AppService, OpsServer],
})
export class AppModule {}
