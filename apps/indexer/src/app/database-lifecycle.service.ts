import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { pgDb } from '@libs/db';
import { DrainableRegistry } from './drainable-registry';

@Injectable()
export class DatabaseLifecycleService implements OnApplicationShutdown {
  constructor(private readonly drainables: DrainableRegistry) {}

  async onApplicationShutdown(): Promise<void> {
    await this.drainables.drainAll();
    await pgDb.destroy();
  }
}
