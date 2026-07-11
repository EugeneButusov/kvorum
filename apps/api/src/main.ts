import 'reflect-metadata';
process.env['OTEL_SERVICE_NAME'] ??= 'api';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app/app.module';
import { configureOpenApi } from './openapi/openapi';
import { getCursorConfig } from './pagination/cursor.config';

async function bootstrap() {
  // Fail fast: H3 requires signed cursors, so the secret must be configured at boot.
  getCursorConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // No signing secret: the session id is an opaque random value looked up in Redis.
  app.use(cookieParser());
  // Per-IP auth rate-limiting reads req.ip; behind the BFF/ingress the client is in
  // X-Forwarded-For. Trust exactly the configured number of proxy hops so the header can't be
  // spoofed past them (default 1 hop).
  app.set('trust proxy', Number(process.env['TRUST_PROXY_HOPS'] ?? 1));
  configureOpenApi(app);
  app.enableShutdownHooks();
  await app.listen(process.env['API_PORT'] ?? 3001);
}

bootstrap();
