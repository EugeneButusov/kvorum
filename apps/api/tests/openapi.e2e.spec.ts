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
