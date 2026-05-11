import { Module } from '@nestjs/common';
import { OpsServer } from '@nest/observability';
import { ShutdownLogger } from './shutdown-logger';
import { IndexerModule } from '../indexer/indexer.module';

@Module({
  imports: [IndexerModule],
  providers: [ShutdownLogger, OpsServer],
})
export class AppModule {}
