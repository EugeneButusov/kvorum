import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DelegationFlowProjectionWriter, VoteEventsProjectionWriter, pgDb } from '@libs/db';
import {
  AAVE_DELEGATOR_ADDRESS,
  AAVE_VOTER_ACTOR_ID,
  AAVE_VOTER_ADDRESS,
  type AaveSeedContext,
  seedAaveData,
} from './aave.seed';
import {
  createRealApp,
  describeHttpIf,
  resetClickhouse,
  resetDaoProposalApiTables,
  type SeedContext,
  seedDaoProposalApiData,
} from '../../apps/api/tests/dao-proposal-api.e2e.helpers';
import { chDb } from '../../libs/db/src/client';

// Deterministic IDs / addresses added for the analytics fixture
const COMP_DELEGATION_ID = '00000000-0000-0000-cccc-000000000001';
const COMP_VOTER_SECONDARY_ADDRESS = `0x${'d0'.repeat(20)}`;
const COMP_VOTER_VOTE_ID = '00000000-0000-0000-cccc-000000000002';

const SEED_DATE = new Date('2026-01-15T12:00:00.000Z');

describeHttpIf('Analytics cross-DAO e2e (X3 PR2)', () => {
  let app: INestApplication;
  let compound: SeedContext;
  let aave: AaveSeedContext;

  beforeAll(async () => {
    app = await createRealApp();
    await resetDaoProposalApiTables();
    await resetClickhouse();

    // Seed baseline Compound + Aave entity data
    compound = await seedDaoProposalApiData();
    aave = await seedAaveData();

    // ── Compound: add a power-bearing delegation in CH ──────────────────────────
    // (gives concentration a non-zero window so it returns 200, not 204)
    const compDelegationWriter = new DelegationFlowProjectionWriter(chDb);
    await compDelegationWriter.insertBatch([
      {
        delegation_id: COMP_DELEGATION_ID,
        dao_id: compound.daoId,
        delegator_address: AAVE_DELEGATOR_ADDRESS, // reuse address — different DAO, no conflict
        delegate_address: AAVE_VOTER_ADDRESS,
        voting_power: '1000000000000000000', // 1 COMP token — power-bearing
        block_number: '20000000',
        log_index: 0,
        event_type: 'votes_changed',
        created_at: SEED_DATE,
      },
    ]);

    // ── Merged-actor setup (S2 fix confirmation) ─────────────────────────────
    // Give the Aave voter a secondary address that was "merged in" from another actor.
    // After the merge, actor_address has (actor_id=AAVE_VOTER_ACTOR_ID, address=secondary).
    await pgDb
      .insertInto('actor_address')
      .values({
        actor_id: AAVE_VOTER_ACTOR_ID,
        address: COMP_VOTER_SECONDARY_ADDRESS,
        is_primary: false,
        source: 'm1_backfill',
      })
      .execute();

    // Seed a vote in the Compound DAO by the secondary (absorbed) address
    const voteWriter = new VoteEventsProjectionWriter(chDb);
    await voteWriter.insertBatch([
      {
        vote_id: COMP_VOTER_VOTE_ID,
        dao_id: compound.daoId,
        proposal_id: compound.proposalId,
        voter_address: COMP_VOTER_SECONDARY_ADDRESS,
        voting_chain_id: '0x1',
        primary_choice: 1,
        voting_power: '500000000000000000',
        cast_at: SEED_DATE,
        block_number: '20000001',
        log_index: 0,
        superseded: 0,
        superseded_at: null,
        superseded_by_vote_id: null,
      },
    ]);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await resetDaoProposalApiTables();
    await resetClickhouse();
  });

  describe('proposal pass-rate (PG-backed, no dict dependency)', () => {
    it('Aave returns separate rows per source_type (v3 + v2)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/daos/aave/analytics/proposal-pass-rate')
        .set('Authorization', aave.bearer)
        .expect(200);

      const data = res.body.data as { source_type: string; pass_rate: number | null }[];
      // Both proposals are in 'executed' state (resolved), so pass-rate rows exist
      const sourceTypes = data.map((row) => row.source_type);
      expect(sourceTypes).toContain('aave_governance_v3');
      expect(sourceTypes).toContain('aave_governor_v2');

      // _meta.derived_through is null for PG-backed pass-rate (per ADR-061 plan note)
      expect(res.body._meta.derived_through).toBeNull();
    });
  });

  describe('concentration (D2 window-level 204)', () => {
    it('Aave returns 204 — no power-bearing delegation in window', async () => {
      await request(app.getHttpServer())
        .get('/v1/daos/aave/analytics/concentration')
        .set('Authorization', aave.bearer)
        .expect(204);
    });

    it('Compound returns 200 — has power-bearing delegation in window', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/daos/compound/analytics/concentration')
        .set('Authorization', compound.bearer)
        .expect(200);

      const data = res.body.data as { total_voting_power: string }[];
      expect(data.length).toBeGreaterThan(0);
      expect(BigInt(data[0]!.total_voting_power)).toBeGreaterThan(0n);
    });

    it('Aave concentration: Cache-Control is present and ETag is absent on 204', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/daos/aave/analytics/concentration')
        .set('Authorization', aave.bearer)
        .expect(204);

      // ETag interceptor skips on null/undefined body — no ETag header on 204
      expect(res.headers['etag']).toBeUndefined();
      // Cache-Control must still be set (aggregation-class: 1-minute public)
      expect(res.headers['cache-control']).toMatch(/max-age=60/);
    });
  });

  describe('cross-DAO proposals filter', () => {
    it('GET /v1/proposals?dao=compound,aave returns proposals from both DAOs', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/proposals?dao=compound,aave')
        .set('Authorization', aave.bearer)
        .expect(200);

      const proposals = res.body.data as { source_type: string; dao_slug: string }[];
      expect(proposals.length).toBeGreaterThanOrEqual(3); // 1 Compound + 2 Aave

      const sourceTypes = proposals.map((p) => p.source_type);
      expect(sourceTypes).toContain('compound_governor_bravo');
      expect(sourceTypes).toContain('aave_governance_v3');
      expect(sourceTypes).toContain('aave_governor_v2');

      const slugs = [...new Set(proposals.map((p) => p.dao_slug))];
      expect(slugs).toContain('compound');
      expect(slugs).toContain('aave');
    });
  });

  describe('cross-DAO actor (S2 merged-actor fix)', () => {
    it('primary address finds votes in Aave (baseline)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/actors/${AAVE_VOTER_ADDRESS}/analytics/cross-dao`)
        .set('Authorization', aave.bearer)
        .expect(200);

      const daos = res.body.daos as { dao_slug: string; votes_cast: number }[];
      // The Aave voter voted on AAVE_V3_PROPOSAL_ID
      const aaveEntry = daos.find((d) => d.dao_slug === 'aave');
      expect(aaveEntry).toBeDefined();
      expect(aaveEntry!.votes_cast).toBe(1);
    });

    it('primary address finds votes under secondary (absorbed) address — confirms single-address fix', async () => {
      // The Aave voter's secondary address (COMP_VOTER_SECONDARY_ADDRESS) voted in Compound DAO.
      // Before the fix, crossDaoSummaryForActor only filtered by primary_address,
      // missing the Compound vote. After the fix (using actor_address IN (...)), both are found.
      const res = await request(app.getHttpServer())
        .get(`/v1/actors/${AAVE_VOTER_ADDRESS}/analytics/cross-dao`)
        .set('Authorization', aave.bearer)
        .expect(200);

      const daos = res.body.daos as { dao_slug: string; votes_cast: number }[];

      // Aave vote (by primary address)
      const aaveEntry = daos.find((d) => d.dao_slug === 'aave');
      expect(aaveEntry).toBeDefined();
      expect(aaveEntry!.votes_cast).toBe(1);

      // Compound vote (by secondary/absorbed address) — only visible with the fix
      const compoundEntry = daos.find((d) => d.dao_slug === 'compound');
      expect(compoundEntry).toBeDefined();
      expect(compoundEntry!.votes_cast).toBe(1);
    });
  });

  describe('delegation-flow (Aave)', () => {
    it('returns 200 and does not include a null-id delegate node from address(0) undelegation', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/daos/aave/analytics/delegation-flow')
        .set('Authorization', aave.bearer)
        .expect(200);

      // address(0) delegate_address maps to delegate_actor_id=null via delegateActorIdFromCh.
      // It must never generate a node (nodes only come from powers/actorsById lookups).
      const nodes = res.body.nodes as { actor_id: string }[];
      for (const node of nodes) {
        expect(node.actor_id).not.toBeNull();
        expect(node.actor_id).not.toBe('00000000-0000-0000-0000-000000000000');
      }
    });
  });
});
