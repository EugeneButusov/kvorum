import { Module } from '@nestjs/common';
import { ShutdownLogger } from './shutdown-logger';
import { IndexerModule } from '../indexer/indexer.module';

@Module({
  imports: [IndexerModule],
  providers: [ShutdownLogger],
})
export class AppModule {}
