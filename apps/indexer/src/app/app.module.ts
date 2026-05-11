import { Module } from '@nestjs/common';
import { OpsServer } from './ops-server';
import { ShutdownLogger } from './shutdown-logger';
import { IndexerModule } from '../indexer/indexer.module';

@Module({
  imports: [IndexerModule],
  providers: [ShutdownLogger, OpsServer],
})
export class AppModule {}
