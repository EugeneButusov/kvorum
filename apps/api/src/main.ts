import 'reflect-metadata';
process.env['OTEL_SERVICE_NAME'] ??= 'api';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app/app.module';
import { configureOpenApi } from './openapi/openapi';
import { getCursorConfig } from './pagination/cursor.config';

async function bootstrap() {
  // Fail fast: H3 requires signed cursors, so the secret must be configured at boot.
  getCursorConfig();
  const app = await NestFactory.create(AppModule);
  // No signing secret: the session id is an opaque random value looked up in Redis.
  app.use(cookieParser());
  configureOpenApi(app);
  app.enableShutdownHooks();
  await app.listen(process.env['API_PORT'] ?? 3001);
}

bootstrap();
