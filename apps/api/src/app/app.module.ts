import { Module } from '@nestjs/common';
import { OpsServer } from '@nest/observability';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';

@Module({
  imports: [],
  controllers: [AppController, HealthController],
  providers: [AppService, OpsServer],
})
export class AppModule {}
