import { describe, expect, it } from 'vitest';
import { toDelegationFlowAnalyticsRow, toVoteEventsAnalyticsRow } from './mirror-etl-readers';

describe('mirror-etl readers encoders', () => {
  it('maps superseded vote and nullable primary choice to sentinels', () => {
    const row = toVoteEventsAnalyticsRow({
      vote_id: '00000000-0000-0000-0000-000000000001',
      proposal_id: '00000000-0000-0000-0000-000000000002',
      voter_actor_id: '00000000-0000-0000-0000-000000000003',
      voter_address: '0xABCDEFabcdefabcdefabcdefabcdefabcdefabcd',
      dao_id: '00000000-0000-0000-0000-000000000004',
      dao_slug: 'compound',
      source_type: 'compound_governor_bravo',
      primary_choice: null,
      voting_power: '123456',
      cast_at: new Date('2026-01-01T00:00:00Z'),
      created_at: new Date('2026-01-01T00:00:01Z'),
      block_number: '100',
      superseded_by_vote_id: '00000000-0000-0000-0000-000000000005',
    } as never);

    expect(row.primary_choice).toBe(-1);
    expect(row.superseded).toBe(1);
    expect(row.voter_address).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
  });

  it('maps null delegate actor id to zero UUID sentinel', () => {
    const row = toDelegationFlowAnalyticsRow({
      delegation_id: '00000000-0000-0000-0000-000000000006',
      delegator_actor_id: '00000000-0000-0000-0000-000000000007',
      delegate_actor_id: null,
      dao_id: '00000000-0000-0000-0000-000000000008',
      dao_slug: 'compound',
      voting_power: '99',
      block_number: '200',
      event_type: 'delegate_changed',
      created_at: new Date('2026-01-01T00:00:02Z'),
    } as never);

    expect(row.delegate_actor_id).toBe('00000000-0000-0000-0000-000000000000');
  });
});
