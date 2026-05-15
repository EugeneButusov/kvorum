import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { createLoggingParams } from './logging.config';

@Module({
  imports: [LoggerModule.forRoot(createLoggingParams())],
})
export class LoggingModule {}
