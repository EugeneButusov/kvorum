import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { BOOTSTRAP_JS, FAVICON_DATA_URI } from './swagger-branding';

let cachedDoc: OpenAPIObject | undefined;

/** Static assets for the docs UI (theme stylesheet, vendored brand faces) hang off this prefix. */
const DOCS_ASSETS_PREFIX = '/v1/docs-assets/';
const THEME_FILE = 'swagger-theme.css';

/**
 * Tag order and copy for the reference. Swagger renders sections in the order tags are
 * declared here, so operational endpoints sort last behind the governance data.
 */
const TAGS: ReadonlyArray<readonly [name: string, description: string]> = [
  [
    'Proposals',
    'Governance proposals across every indexed DAO — listings, full detail, tally, and the AI-derived analyses (summary, calldata mismatch, forum synthesis).',
  ],
  ['Votes', 'Individual votes cast on a proposal, and the per-voter lookup.'],
  ['DAOs', 'The DAO directory and the governance sources configured for each.'],
  [
    'Delegations',
    'Delegation events, a delegate’s current delegator set, and an actor’s outgoing delegation.',
  ],
  ['Actors', 'Addresses and identities — profile, voting history, and proposals authored.'],
  [
    'Search',
    'Cross-entity keyword search over proposals, DAOs, and actors, with automatic address detection.',
  ],
  [
    'Analytics',
    'Aggregated governance health: pass rates, voting-power concentration, delegation flow, and delegate alignment.',
  ],
  ['Forum', 'Discourse forum threads linked to on-chain proposals.'],
  ['Service', 'Liveness and service metadata. Unauthenticated.'],
];

const DESCRIPTION = `
Read API over DAO governance data — proposals, votes, delegations, actors, and the
analytics derived from them. Every response is served from indexed chain state at the
confirmed head; nothing is read live from an RPC node.

## Authentication

All \`/v1\` endpoints require an API key, sent as a bearer token:

\`\`\`
Authorization: Bearer kv_live_…
\`\`\`

Keys are issued from the developer dashboard at
[app.kvorum.watch/developer](https://app.kvorum.watch/developer). \`GET /\` and
\`GET /health\` are unauthenticated.

## Rate limits

Limits are applied per key and returned on every response as \`X-RateLimit-Limit\`,
\`X-RateLimit-Remaining\`, and \`X-RateLimit-Reset\`. Exceeding a limit returns
\`429\` with a \`Retry-After\` header.

## Pagination

List endpoints are cursor-paginated. Pass \`limit\` and follow the \`next_cursor\`
returned in the response envelope. Cursors are signed and opaque — construct them only
from a previous response, never by hand.

## Versioning

The path carries the major version. Additive changes (new fields, new endpoints) ship
without notice; removals and breaking changes go to a new major.

## Errors

Failures return a JSON body with a stable machine-readable \`code\`, a human-readable
\`message\`, and the HTTP status.
`.trim();

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

/**
 * Cache-busting token for the theme stylesheet: the first bytes of its own digest, so a deploy
 * that changes the CSS changes the URL. That is what lets the assets route below hand out a
 * one-year immutable cache — the fonts under it are versioned by filename (see assets/fonts/
 * README.md), and the stylesheet is versioned here.
 */
function themeVersion(assetsDir: string): string {
  try {
    const css = readFileSync(join(assetsDir, THEME_FILE));
    return createHash('sha256').update(css).digest('hex').slice(0, 12);
  } catch {
    return '0';
  }
}

/**
 * Directory holding the docs UI's static assets. Resolved by probing rather than from
 * `__dirname` because the app is webpack-bundled to dist/apps/api/main.js while these
 * files stay in the source tree — and cwd differs between the container (repo root,
 * per the Dockerfile CMD) and `pnpm --filter api start` (apps/api). Same approach as
 * `packageVersion()` above.
 */
export function resolveDocsAssetsDir(): string | undefined {
  const candidates = [
    join(process.cwd(), 'apps/api/src/openapi/assets'),
    join(process.cwd(), 'src/openapi/assets'),
  ];
  return candidates.find((path) => existsSync(path));
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Kvorum API')
    .setDescription(DESCRIPTION)
    .setVersion(packageVersion())
    .addServer('https://api.kvorum.watch', 'Production')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API Key',
        description: 'ADR-025 API-key bearer authentication',
      },
      'bearer',
    );

  for (const [name, description] of TAGS) {
    builder.addTag(name, description);
  }

  const doc = SwaggerModule.createDocument(app, builder.build());
  doc.openapi = '3.1.0';
  return doc;
}

export function configureOpenApi(app: NestExpressApplication): void {
  const assetsDir = resolveDocsAssetsDir();
  if (assetsDir !== undefined) {
    // Registered before SwaggerModule so it can never be shadowed by the assets
    // swagger-ui-express serves under /v1/docs.
    app.useStaticAssets(assetsDir, {
      prefix: DOCS_ASSETS_PREFIX,
      maxAge: '1y',
      immutable: true,
    });
  }

  const documentFactory = () => {
    cachedDoc ??= buildOpenApiDocument(app);
    return cachedDoc;
  };

  SwaggerModule.setup('v1/docs', app, documentFactory, {
    jsonDocumentUrl: 'v1/openapi.json',
    yamlDocumentUrl: 'v1/openapi.yaml',
    customSiteTitle: 'Kvorum API · Reference',
    customfavIcon: FAVICON_DATA_URI,
    // Linked rather than inlined: the stylesheet is a real file under assets/, so it caches
    // independently of the shell and stays out of the bundler entirely. (It was briefly a
    // `?raw` import — webpack inlined it correctly, but Vite's CSS plugin claims `.css?raw`
    // and hands back an empty string, so every test saw an unthemed page.)
    ...(assetsDir === undefined
      ? {}
      : { customCssUrl: `${DOCS_ASSETS_PREFIX}${THEME_FILE}?v=${themeVersion(assetsDir)}` }),
    customJsStr: BOOTSTRAP_JS,
  });
}
