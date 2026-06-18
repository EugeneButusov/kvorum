import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  COMP_BRAVO_SOURCE_ID,
  COMP_DELEGATOR_ADDRESS,
  COMP_OZ_SOURCE_ID,
  COMP_VOTER_ADDRESS,
  type CompoundSeedContext,
  seedCompoundData,
} from './compound.seed';
import {
  createRealApp,
  describeHttpIf,
  resetClickhouse,
  resetDaoProposalApiTables,
} from '../../apps/api/tests/dao-proposal-api.e2e.helpers';

describeHttpIf('Compound entity endpoints e2e (X3 PR1 parity)', () => {
  let app: INestApplication;
  let seeded: CompoundSeedContext;

  beforeAll(async () => {
    app = await createRealApp();
    await resetDaoProposalApiTables();
    await resetClickhouse();
    seeded = await seedCompoundData();
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await resetDaoProposalApiTables();
    await resetClickhouse();
  });

  it('returns Compound DAO detail with all 3 governor sources', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/daos/compound')
      .set('Authorization', seeded.bearer)
      .expect(200);

    const dao = res.body.data as Record<string, unknown>;
    expect(dao['slug']).toBe('compound');
    const sourceTypes = (dao['sources'] as { source_type: string }[]).map((s) => s.source_type);
    expect(sourceTypes).toContain('compound_governor_bravo');
    expect(sourceTypes).toContain('compound_governor_alpha');
    expect(sourceTypes).toContain('compound_governor_oz');
  });

  it('returns Compound proposals list with both governor source types', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/daos/compound/proposals')
      .set('Authorization', seeded.bearer)
      .expect(200);

    const proposals = res.body.data as { source_type: string; source_id: string }[];
    expect(proposals.length).toBe(2);
    const sourceTypes = proposals.map((p) => p.source_type);
    expect(sourceTypes).toContain('compound_governor_bravo');
    expect(sourceTypes).toContain('compound_governor_oz');
  });

  describe('Compound proposal detail', () => {
    it('includes on-chain actions (Compound-specific calldata) and no payloads block', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/daos/compound/proposals/compound_governor_bravo/${COMP_BRAVO_SOURCE_ID}`)
        .set('Authorization', seeded.bearer)
        .expect(200);

      const proposal = res.body.data as Record<string, unknown>;
      expect(proposal['source_type']).toBe('compound_governor_bravo');

      // Compound proposals carry on-chain calldata actions.
      const actions = proposal['actions'] as {
        target_address: string;
        value_wei: string;
        function_signature: string | null;
      }[];
      expect(Array.isArray(actions)).toBe(true);
      expect(actions.length).toBeGreaterThan(0);
      const action = actions[0]!;
      expect(typeof action.target_address).toBe('string');
      expect(typeof action.value_wei).toBe('string');
      expect(action.function_signature).toBe('setCollateralFactor(address,uint256)');

      // Compound proposals have no cross-chain voting machine block (Aave v3-only).
      expect(proposal['voting']).toBeUndefined();
      // Compound proposals have no payloads block (Aave v3-only).
      expect(proposal['payloads']).toBeUndefined();
    });

    it('returns OZ governor proposal at its source_id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/daos/compound/proposals/compound_governor_oz/${COMP_OZ_SOURCE_ID}`)
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(res.body.data['source_type']).toBe('compound_governor_oz');
      expect(res.body.data['source_id']).toBe(COMP_OZ_SOURCE_ID);
    });
  });

  describe('Compound votes', () => {
    it('returns vote with voting_chain_id=0x1 (same-chain) and non-zero voting_power', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/daos/compound/proposals/compound_governor_bravo/${COMP_BRAVO_SOURCE_ID}/votes`)
        .set('Authorization', seeded.bearer)
        .expect(200);

      const votes = res.body.data as {
        voter: { address: string };
        voting_chain_id: string;
        voting_power_reported: string;
        primary_choice: number | null;
      }[];
      expect(votes.length).toBe(1);

      const vote = votes[0]!;
      // Compound votes are same-chain: voting_chain_id matches governance chain.
      expect(vote.voting_chain_id).toBe('0x1');
      expect(vote.voter.address).toBe(COMP_VOTER_ADDRESS);
      // Compound voting_power is non-zero (unlike Aave relationship-only delegation).
      expect(BigInt(vote.voting_power_reported)).toBeGreaterThan(0n);
      expect([0, 1, 2]).toContain(vote.primary_choice);
    });
  });

  describe('Compound delegations', () => {
    it('returns power-bearing delegate_changed rows (voting_power > 0)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/daos/compound/delegations?delegator=${COMP_DELEGATOR_ADDRESS}`)
        .set('Authorization', seeded.bearer)
        .expect(200);

      const delegations = res.body.data as {
        delegator: { address: string };
        delegate: { address: string } | null;
        event_type: string;
        voting_power: string;
      }[];
      expect(delegations.length).toBeGreaterThanOrEqual(1);

      const delegateChanged = delegations.find((d) => d.event_type === 'delegate_changed');
      expect(delegateChanged).toBeDefined();
      expect(delegateChanged!.delegator.address).toBe(COMP_DELEGATOR_ADDRESS);
      // Compound delegation carries actual voting power (power-bearing, not relationship-only).
      expect(BigInt(delegateChanged!.voting_power)).toBeGreaterThan(0n);
    });

    it('returns votes_changed rows for the delegate (power event, Compound-specific)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/daos/compound/delegations?delegator=${COMP_VOTER_ADDRESS}`)
        .set('Authorization', seeded.bearer)
        .expect(200);

      const delegations = res.body.data as { event_type: string; voting_power: string }[];
      const votesChanged = delegations.find((d) => d.event_type === 'votes_changed');
      expect(votesChanged).toBeDefined();
      expect(BigInt(votesChanged!.voting_power)).toBeGreaterThan(0n);
    });
  });
});
