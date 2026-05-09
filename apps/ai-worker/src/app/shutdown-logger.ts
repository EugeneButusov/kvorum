import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';

@Injectable()
export class ShutdownLogger implements OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownLogger.name);

  onApplicationShutdown(signal?: string) {
    this.logger.log(`[ai-worker] shutting down (signal: ${signal ?? 'unknown'})`);
  }
}
