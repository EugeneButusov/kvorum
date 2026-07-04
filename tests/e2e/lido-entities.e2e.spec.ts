import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  LIDO_ARAGON_SOURCE_ID,
  LIDO_DG_SOURCE_ID,
  LIDO_EASYTRACK_SOURCE_ID,
  LIDO_SNAPSHOT_SOURCE_ID,
  type LidoSeedContext,
  seedLidoData,
} from './lido.seed';
import {
  createRealApp,
  describeHttpIf,
  resetClickhouse,
  resetDaoProposalApiTables,
} from '../../apps/api/tests/dao-proposal-api.e2e.helpers';

describeHttpIf('Lido four-track entity endpoints e2e', () => {
  let app: INestApplication;
  let seeded: LidoSeedContext;

  beforeAll(async () => {
    app = await createRealApp();
    await resetDaoProposalApiTables();
    await resetClickhouse();
    seeded = await seedLidoData();
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await resetDaoProposalApiTables();
    await resetClickhouse();
  });

  it('lists all four tracks as distinct source_types', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/daos/lido/proposals')
      .set('Authorization', seeded.bearer)
      .expect(200);
    const sourceTypes = (res.body.data as { source_type: string }[]).map((p) => p.source_type);
    expect(sourceTypes.sort()).toEqual(
      ['aragon_voting', 'dual_governance', 'easy_track', 'snapshot'].sort(),
    );
  });

  it('Aragon proposal detail carries aragon metadata + a high-confidence forum link', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/daos/lido/proposals/aragon_voting/${LIDO_ARAGON_SOURCE_ID}`)
      .set('Authorization', seeded.bearer)
      .expect(200);
    const data = res.body.data as Record<string, unknown>;
    expect(data['source_type']).toBe('aragon_voting');
    expect((data['metadata'] as { kind: string }).kind).toBe('aragon_voting');
    expect((data['metadata'] as { support_required_pct: string }).support_required_pct).toBe(
      '500000000000000000',
    );
    const links = data['offchain_discussion_links'] as { confidence: string; platform: string }[];
    expect(links).toHaveLength(1);
    expect(links[0]?.confidence).toBe('high');
    expect(links[0]?.platform).toBe('discourse');
  });

  it('Snapshot proposal detail carries snapshot metadata (voting_type + scores_state)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/daos/lido/proposals/snapshot/${LIDO_SNAPSHOT_SOURCE_ID}`)
      .set('Authorization', seeded.bearer)
      .expect(200);
    const meta = (res.body.data as { metadata: Record<string, unknown> }).metadata;
    expect(meta['kind']).toBe('snapshot');
    expect(meta['voting_type']).toBe('weighted');
    expect(meta['scores_state']).toBe('final');
  });

  it('Easy Track + Dual Governance proposal details carry their metadata', async () => {
    const et = await request(app.getHttpServer())
      .get(`/v1/daos/lido/proposals/easy_track/${LIDO_EASYTRACK_SOURCE_ID}`)
      .set('Authorization', seeded.bearer)
      .expect(200);
    expect((et.body.data as { metadata: { kind: string } }).metadata.kind).toBe('easy_track');

    const dg = await request(app.getHttpServer())
      .get(`/v1/daos/lido/proposals/dual_governance/${LIDO_DG_SOURCE_ID}`)
      .set('Authorization', seeded.bearer)
      .expect(200);
    const dgMeta = (dg.body.data as { metadata: Record<string, unknown> }).metadata;
    expect(dgMeta['kind']).toBe('dual_governance');
    expect(dgMeta['origin']).toBe('direct');
  });

  it('Snapshot vote returns the weighted multi-choice breakdown + reported power', async () => {
    const res = await request(app.getHttpServer())
      .get(
        `/v1/daos/lido/proposals/snapshot/${LIDO_SNAPSHOT_SOURCE_ID}/votes/${seeded.voterAddress}`,
      )
      .set('Authorization', seeded.bearer)
      .expect(200);
    const data = res.body.data as { voting_power_reported: string; choices: unknown[] };
    expect(data.voting_power_reported).toBe('3000000000000000000');
    expect(data.choices).toEqual([
      { choice_index: 1, weight: '0.6' },
      { choice_index: 2, weight: '0.4' },
    ]);
  });

  it('Aragon vote returns the LDO-stake reported power', async () => {
    const res = await request(app.getHttpServer())
      .get(
        `/v1/daos/lido/proposals/aragon_voting/${LIDO_ARAGON_SOURCE_ID}/votes/${seeded.voterAddress}`,
      )
      .set('Authorization', seeded.bearer)
      .expect(200);
    expect((res.body.data as { voting_power_reported: string }).voting_power_reported).toBe(
      '5000000000000000000',
    );
  });

  it('surfaces off-chain (Snapshot) delegation on the actor delegation endpoint', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/daos/lido/actors/${seeded.delegatorAddress}/delegation`)
      .set('Authorization', seeded.bearer)
      .expect(200);
    const data = res.body.data as { evm: unknown; offchain: Record<string, unknown>[] };
    expect(data.evm).toBeNull();
    expect(data.offchain).toHaveLength(1);
    expect(data.offchain[0]?.['platform']).toBe('snapshot');
    expect(data.offchain[0]?.['delegate_address']).toBe(seeded.delegateAddress);
    expect(data.offchain[0]?.['scope']).toBe('lido-snapshot.eth');
  });

  it('proposal pass-rate returns a separate row per track (not collapsed)', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/daos/lido/analytics/proposal-pass-rate')
      .set('Authorization', seeded.bearer)
      .expect(200);
    const rows = res.body.data as { source_type: string }[];
    const sourceTypes = new Set(rows.map((r) => r.source_type));
    expect(sourceTypes.has('aragon_voting')).toBe(true);
    expect(sourceTypes.has('snapshot')).toBe(true);
    // Distinct rows per track — no single collapsed "Lido" figure.
    expect(sourceTypes.size).toBeGreaterThanOrEqual(3);
  });

  it('Lido concentration returns 204 — no on-chain power-bearing delegation', async () => {
    await request(app.getHttpServer())
      .get('/v1/daos/lido/analytics/concentration')
      .set('Authorization', seeded.bearer)
      .expect(204);
  });
});
