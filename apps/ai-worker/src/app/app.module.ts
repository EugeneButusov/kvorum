import { Module } from '@nestjs/common';
import { OpsServer } from '@nest/observability';
import { ShutdownLogger } from './shutdown-logger';

@Module({
  providers: [ShutdownLogger, OpsServer],
})
export class AppModule {}
