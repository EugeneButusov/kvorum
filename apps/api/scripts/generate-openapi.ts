import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

process.env['OTEL_SERVICE_NAMESPACE'] ??= 'dev';
process.env['OTEL_SERVICE_NAME'] ??= 'api';
process.env['CURSOR_SECRET'] ??= 'openapi-generate-secret';
process.env['HMAC_PEPPER_CURRENT'] ??= Buffer.alloc(32, 7).toString('base64');
process.env['DATABASE_URL'] ??= 'postgresql://kvorum:kvorum@localhost:55432/kvorum';
process.env['REDIS_URL'] ??= 'redis://localhost:56379';

async function main(): Promise<void> {
  const [{ NestFactory }, { AppModule }, { buildOpenApiDocument }] = await Promise.all([
    import('@nestjs/core'),
    import('../src/app/app.module'),
    import('../src/openapi/openapi'),
  ]);

  const app = await NestFactory.create(AppModule, { logger: false });
  const { default: cookieParser } = await import('cookie-parser');
  app.use(cookieParser());
  await app.init();

  try {
    const doc = buildOpenApiDocument(app);
    const serialized = `${JSON.stringify(doc, null, 2)}\n`;
    await writeFile(join(process.cwd(), 'docs/openapi.json'), serialized, 'utf8');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
