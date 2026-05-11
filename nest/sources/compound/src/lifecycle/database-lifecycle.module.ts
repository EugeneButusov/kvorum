import { Module } from '@nestjs/common';
import { DatabaseLifecycleService } from './database-lifecycle.service';
import { DrainableRegistry } from './drainable-registry';

@Module({
  providers: [DrainableRegistry, DatabaseLifecycleService],
  exports: [DrainableRegistry],
})
export class DatabaseLifecycleModule {}
