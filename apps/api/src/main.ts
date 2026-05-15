import 'reflect-metadata';
process.env['OTEL_SERVICE_NAME'] ??= 'api';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import { getCursorConfig } from './pagination/cursor.config';

async function bootstrap() {
  // Fail fast: H3 requires signed cursors, so the secret must be configured at boot.
  getCursorConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.listen(process.env['API_PORT'] ?? 3001);
}

bootstrap();
