import { Module } from '@nestjs/common';
import { DrainableRegistry } from './drainable-registry';
import { DatabaseLifecycleService } from './database-lifecycle.service';

@Module({
  providers: [DrainableRegistry, DatabaseLifecycleService],
  exports: [DrainableRegistry],
})
export class DatabaseLifecycleModule {}
