import { Module } from '@nestjs/common';
import { OpsServer } from '@nest/observability';
import { EventLoopMetricsService } from './event-loop-metrics.service';
import { ShutdownLogger } from './shutdown-logger';
import { IndexerModule } from '../indexer/indexer.module';

@Module({
  imports: [IndexerModule],
  providers: [ShutdownLogger, EventLoopMetricsService, OpsServer],
})
export class AppModule {}
