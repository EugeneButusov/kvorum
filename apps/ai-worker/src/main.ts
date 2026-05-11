import 'reflect-metadata';
process.env['OTEL_SERVICE_NAME'] ??= 'ai-worker';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log('[ai-worker] started', 'Bootstrap');
}

bootstrap();
