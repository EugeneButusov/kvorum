import { Module } from '@nestjs/common';
import { DatabaseLifecycleModule } from '@nest/compound';
import { ShutdownLogger } from './shutdown-logger';
import { IndexerModule } from '../indexer/indexer.module';

@Module({
  imports: [DatabaseLifecycleModule, IndexerModule],
  providers: [ShutdownLogger],
})
export class AppModule {}
