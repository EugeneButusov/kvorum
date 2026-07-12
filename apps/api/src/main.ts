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
  // req.ip drives per-IP rate limiting. Behind the BFF/ingress the real client is in
  // X-Forwarded-For, so we resolve it from there — but ONLY for connections from known proxies.
  app.set('trust proxy', parseTrustProxy(process.env['TRUST_PROXY']));
  configureOpenApi(app);
  app.enableShutdownHooks();
  await app.listen(process.env['API_PORT'] ?? 3001);
}

// Express `trust proxy`. Prefer an explicit IP/CIDR allowlist (only those proxies may set the
// forwarded client IP — a direct client spoofing X-Forwarded-For is ignored and limited by its real
// socket IP). Accepts: unset → trust none (use the socket IP); an integer → that many proxy hops;
// otherwise a comma-separated list of proxy IPs/CIDRs (or presets like "loopback").
function parseTrustProxy(raw: string | undefined): boolean | number | string[] {
  if (raw === undefined || raw.trim() === '') {
    return false;
  }
  if (/^\d+$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  return raw.split(',').map((entry) => entry.trim());
}

bootstrap();
