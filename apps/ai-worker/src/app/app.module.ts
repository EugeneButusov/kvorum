import { Module } from '@nestjs/common';
import { OpsServer } from './ops-server';
import { ShutdownLogger } from './shutdown-logger';

@Module({
  providers: [ShutdownLogger, OpsServer],
})
export class AppModule {}
