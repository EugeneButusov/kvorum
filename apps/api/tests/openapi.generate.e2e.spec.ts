import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import {
  createRealApp,
  resetDaoProposalApiTables,
  seedDaoProposalApiData,
} from './dao-proposal-api.e2e.helpers';

const describeGenerate = process.env['GENERATE_OPENAPI'] === '1' ? describe : describe.skip;
const OPENAPI_FILE = resolve(process.cwd(), '../../docs/openapi.json');

describeGenerate('openapi generator', () => {
  it('writes docs/openapi.json from the live app document route', async () => {
    const previousOpsPort = process.env['OPS_PORT'];
    process.env['OPS_PORT'] = '19095';

    const app = await createRealApp();

    try {
      await resetDaoProposalApiTables();
      await seedDaoProposalApiData();

      const res = await request(app.getHttpServer()).get('/v1/openapi.json').expect(200);
      const serialized = `${JSON.stringify(res.body, null, 2)}\n`;
      writeFileSync(OPENAPI_FILE, serialized, 'utf8');
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
