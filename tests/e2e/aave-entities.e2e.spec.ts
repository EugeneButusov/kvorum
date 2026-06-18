import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  AAVE_DELEGATOR_ADDRESS,
  AAVE_V3_SOURCE_ID,
  AAVE_VOTING_CHAIN_ID,
  AAVE_VOTER_ADDRESS,
  type AaveSeedContext,
  seedAaveData,
} from './aave.seed';
import {
  createRealApp,
  describeHttpIf,
  resetClickhouse,
  resetDaoProposalApiTables,
} from '../../apps/api/tests/dao-proposal-api.e2e.helpers';

describeHttpIf('Aave entity endpoints e2e (X3 PR1)', () => {
  let app: INestApplication;
  let seeded: AaveSeedContext;

  beforeAll(async () => {
    app = await createRealApp();
    await resetDaoProposalApiTables();
    await resetClickhouse();
    seeded = await seedAaveData();
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await resetDaoProposalApiTables();
    await resetClickhouse();
  });

  it('returns Aave DAO detail with sources', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/daos/aave')
      .set('Authorization', seeded.bearer)
      .expect(200);

    const dao = res.body.data as Record<string, unknown>;
    expect(dao['slug']).toBe('aave');
    expect(Array.isArray(dao['sources'])).toBe(true);
    const sourceTypes = (dao['sources'] as { source_type: string }[]).map((s) => s.source_type);
    expect(sourceTypes).toContain('aave_governance_v3');
    expect(sourceTypes).toContain('aave_voting_machine');
    expect(sourceTypes).toContain('aave_governor_v2');
  });

  it('returns Aave proposals list with both source types', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/daos/aave/proposals')
      .set('Authorization', seeded.bearer)
      .expect(200);

    const proposals = res.body.data as { source_type: string; source_id: string }[];
    expect(proposals.length).toBe(2);
    const sourceTypes = proposals.map((p) => p.source_type);
    expect(sourceTypes).toContain('aave_governance_v3');
    expect(sourceTypes).toContain('aave_governor_v2');
  });

  describe('Aave v3 proposal detail', () => {
    it('includes voting block with correct voting_chain_id and origin_chain_id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/daos/aave/proposals/aave_governance_v3/${AAVE_V3_SOURCE_ID}`)
        .set('Authorization', seeded.bearer)
        .expect(200);

      const proposal = res.body.data as Record<string, unknown>;
      expect(proposal['source_type']).toBe('aave_governance_v3');
      expect(proposal['origin_chain_id']).toBe('0x1');

      const voting = proposal['voting'] as Record<string, unknown>;
      expect(voting).not.toBeNull();
      expect(voting['voting_chain_id']).toBe(AAVE_VOTING_CHAIN_ID);
      expect(typeof voting['creation_block']).toBe('string');
    });

    it('includes payloads grouped by target_chain_id including a non-executed (lossy) payload', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/daos/aave/proposals/aave_governance_v3/${AAVE_V3_SOURCE_ID}`)
        .set('Authorization', seeded.bearer)
        .expect(200);

      const proposal = res.body.data as Record<string, unknown>;
      const groups = proposal['payloads'] as {
        target_chain_id: string;
        payloads: { status: string; payload_id: string }[];
      }[];
      expect(Array.isArray(groups)).toBe(true);
      expect(groups.length).toBe(2);

      const chainIds = groups.map((g) => g.target_chain_id);
      expect(chainIds).toContain('0x1');
      expect(chainIds).toContain(AAVE_VOTING_CHAIN_ID);

      const allPayloads = groups.flatMap((g) => g.payloads);
      const statuses = allPayloads.map((p) => p.status);
      expect(statuses).toContain('executed');
      expect(statuses).toContain('queued'); // non-executed → lossy gap (Polygon)
    });
  });

  describe('Aave v3 votes', () => {
    it('returns vote with voting_chain_id matching the Polygon voting machine chain', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/daos/aave/proposals/aave_governance_v3/${AAVE_V3_SOURCE_ID}/votes`)
        .set('Authorization', seeded.bearer)
        .expect(200);

      const votes = res.body.data as {
        voter: { address: string };
        voting_chain_id: string;
        primary_choice: number | null;
      }[];
      expect(votes.length).toBe(1);

      const vote = votes[0]!;
      expect(vote.voting_chain_id).toBe(AAVE_VOTING_CHAIN_ID);
      expect(vote.voter.address).toBe(AAVE_VOTER_ADDRESS);
      // primary_choice must be 0 or 1 (For/Against) per SourceApiRegistry.choiceBounds
      expect(vote.primary_choice).not.toBeNull();
      expect([0, 1]).toContain(vote.primary_choice);
    });
  });

  describe('Aave delegations', () => {
    it('returns delegation rows scoped to Aave DAO', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/daos/aave/delegations?delegator=${AAVE_DELEGATOR_ADDRESS}`)
        .set('Authorization', seeded.bearer)
        .expect(200);

      const delegations = res.body.data as {
        delegator: { address: string };
        delegate: { address: string } | null;
        event_type: string;
      }[];
      // Both the delegation and undelegation rows are returned (each has a unique delegation_id)
      expect(delegations.length).toBeGreaterThanOrEqual(2);

      for (const d of delegations) {
        expect(d.event_type).toBe('delegate_changed'); // Aave is relationship-only
        expect(d.delegator.address).toBe(AAVE_DELEGATOR_ADDRESS);
      }
    });

    it('returns delegate: null for address(0) undelegation', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/daos/aave/delegations?delegator=${AAVE_DELEGATOR_ADDRESS}`)
        .set('Authorization', seeded.bearer)
        .expect(200);

      const delegations = res.body.data as {
        delegate: { address: string } | null;
      }[];

      // The undelegation row (delegated to address(0)) must appear as delegate: null
      const undelegation = delegations.find((d) => d.delegate === null);
      expect(undelegation).toBeDefined();
    });
  });
});
