import { Module } from '@nestjs/common';
import { ShutdownLogger } from './shutdown-logger';
import { DatabaseLifecycleModule } from '@nest/sources-compound';
import { IndexerModule } from '../indexer/indexer.module';

@Module({
  imports: [DatabaseLifecycleModule, IndexerModule],
  providers: [ShutdownLogger],
})
export class AppModule {}
