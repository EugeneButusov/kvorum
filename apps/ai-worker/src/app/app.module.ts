import { Module } from '@nestjs/common';
import { ShutdownLogger } from './shutdown-logger';

@Module({
  providers: [ShutdownLogger],
})
export class AppModule {}
