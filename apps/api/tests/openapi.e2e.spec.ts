import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as OpenAPIParser from '@readme/openapi-parser';
import request from 'supertest';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
  seedDaoProposalApiData,
} from './dao-proposal-api.e2e.helpers';

describeHttpIf('openapi e2e', () => {
  it('serves public OpenAPI JSON and docs UI', async () => {
    const previousOpsPort = process.env['OPS_PORT'];
    process.env['OPS_PORT'] = '19094';

    const app = await createRealApp();

    try {
      await resetDaoProposalApiTables();
      await seedDaoProposalApiData();

      const openapiRes = await request(app.getHttpServer()).get('/v1/openapi.json').expect(200);
      expect(openapiRes.headers['content-type']).toContain('application/json');

      const doc = openapiRes.body as Record<string, unknown>;
      expect(doc.openapi).toBe('3.1.0');

      await OpenAPIParser.validate(JSON.parse(JSON.stringify(doc)), { validate: { spec: true } });

      const docsRes = await request(app.getHttpServer()).get('/v1/docs').expect(200);
      expect(docsRes.headers['content-type']).toContain('text/html');

      // The docs shell must arrive themed and branded, not as stock Swagger UI: the palette is
      // inlined as customCss, the topbar shim as customJsStr, and the title/favicon replace
      // Swagger's own. A regression here is invisible to every other assertion in this file.
      const shell = docsRes.text;
      expect(shell).toContain('<title>Kvorum API · Reference</title>');
      expect(shell).toContain('data:image/svg+xml,');
      expect(shell).toContain('kv-brand-word');

      // The theme is linked, not inlined, and cache-busted by its own digest.
      const themeHref = /\/v1\/docs-assets\/swagger-theme\.css\?v=[0-9a-f]{12}/.exec(shell)?.[0];
      expect(themeHref).toBeDefined();

      const themeRes = await request(app.getHttpServer())
        .get(themeHref ?? '')
        .expect(200);
      expect(themeRes.headers['content-type']).toContain('text/css');
      expect(themeRes.text).toContain('--accent: #00804f');
      expect(themeRes.text).toContain(':root:root:root .swagger-ui');

      // Self-hosted faces, referenced by that CSS and served from the app — not a font CDN.
      for (const file of [
        'inter-latin-wght-normal.woff2',
        'jetbrains-mono-latin-wght-normal.woff2',
      ]) {
        const href = `/v1/docs-assets/fonts/${file}`;
        expect(themeRes.text).toContain(href);
        const fontRes = await request(app.getHttpServer()).get(href).expect(200);
        expect(fontRes.headers['content-type']).toContain('font/woff2');
      }

      const committed = JSON.parse(
        readFileSync(resolve(process.cwd(), '../../docs/openapi.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(openapiRes.body).toEqual(committed);
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
      if (previousOpsPort === undefined) {
        delete process.env['OPS_PORT'];
      } else {
        process.env['OPS_PORT'] = previousOpsPort;
      }
    }
  });
});
