import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

let cachedDoc: OpenAPIObject | undefined;

function packageVersion(): string {
  const candidates = [
    join(process.cwd(), 'apps/api/package.json'),
    join(process.cwd(), 'package.json'),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf8');
      const pkg = JSON.parse(raw) as { version?: string };
      return pkg.version ?? '0.0.0';
    } catch {
      // Try the next candidate path.
    }
  }
  return '0.0.0';
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Kvorum API')
    .setDescription('Kvorum M1 DAO + proposal read API')
    .setVersion(packageVersion())
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API Key',
        description: 'ADR-025 API-key bearer authentication',
      },
      'bearer',
    )
    .build();

  const doc = SwaggerModule.createDocument(app, config);
  doc.openapi = '3.1.0';
  return doc;
}

export function configureOpenApi(app: INestApplication): void {
  const documentFactory = () => {
    cachedDoc ??= buildOpenApiDocument(app);
    return cachedDoc;
  };

  SwaggerModule.setup('v1/docs', app, documentFactory, {
    jsonDocumentUrl: 'v1/openapi.json',
    yamlDocumentUrl: 'v1/openapi.yaml',
  });
}
