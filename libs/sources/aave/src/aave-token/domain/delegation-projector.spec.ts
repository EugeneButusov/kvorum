import { describe, expect, it } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import {
  projectVotingDelegateChanged,
  projectSweepVotesChanged,
  ZERO_ADDRESS,
} from './delegation-projector';

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'aave_token',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 3,
  event_type: 'DelegateChanged',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

describe('aave-token delegation-projector', () => {
  it('projects a VOTING DelegateChanged into a delegate_changed row', () => {
    const projection = projectVotingDelegateChanged(
      {
        delegator: `0x${'ab'.repeat(20)}`,
        delegatee: `0x${'ef'.repeat(20)}`,
        delegationType: 0,
      },
      ROW,
      { daoId: 'dao-1' },
    );

    expect(projection).toEqual({
      delegation_id: 'archive-1',
      dao_id: 'dao-1',
      delegator_address: `0x${'ab'.repeat(20)}`,
      delegate_address: `0x${'ef'.repeat(20)}`,
      voting_power: '0',
      block_number: '100',
      log_index: 3,
      event_type: 'delegate_changed',
      created_at: new Date('2026-01-01T00:00:00Z'),
    });
  });

  it('maps an address(0) delegatee (undelegation) to the zero-delegate sentinel', () => {
    const projection = projectVotingDelegateChanged(
      {
        delegator: `0x${'ab'.repeat(20)}`,
        delegatee: ZERO_ADDRESS,
        delegationType: 0,
      },
      ROW,
      { daoId: 'dao-1' },
    );

    expect(projection.delegate_address).toBe(ZERO_ADDRESS);
  });

  it('exports the canonical zero-address constant', () => {
    expect(ZERO_ADDRESS).toBe('0x0000000000000000000000000000000000000000');
  });
});

describe('projectSweepVotesChanged', () => {
  it('produces a votes_changed row with self-referential delegate/delegator', () => {
    const delegate = `0x${'cd'.repeat(20)}`;
    const row = projectSweepVotesChanged(delegate, 1_000_000n, {
      daoId: 'dao-1',
      delegationId: 'sweep-1',
      blockNumber: '200',
      createdAt: new Date('2026-06-01T00:00:00Z'),
    });

    expect(row).toEqual({
      delegation_id: 'sweep-1',
      dao_id: 'dao-1',
      delegator_address: delegate,
      delegate_address: delegate,
      voting_power: '1000000',
      block_number: '200',
      log_index: 0,
      event_type: 'votes_changed',
      created_at: new Date('2026-06-01T00:00:00Z'),
    });
  });

  it('writes zero power for delegates who lost all voting power', () => {
    const row = projectSweepVotesChanged(`0x${'ab'.repeat(20)}`, 0n, {
      daoId: 'dao-1',
      delegationId: 'sweep-2',
      blockNumber: '300',
      createdAt: new Date('2026-06-02T00:00:00Z'),
    });

    expect(row.voting_power).toBe('0');
    expect(row.event_type).toBe('votes_changed');
  });

  it('lowercases the delegate address', () => {
    const row = projectSweepVotesChanged('0xABCDEF1234567890ABCDEF1234567890ABCDEF12', 100n, {
      daoId: 'dao-1',
      delegationId: 'sweep-3',
      blockNumber: '400',
      createdAt: new Date('2026-06-03T00:00:00Z'),
    });

    expect(row.delegator_address).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
    expect(row.delegate_address).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });
});
