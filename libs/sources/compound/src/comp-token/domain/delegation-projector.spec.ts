import { describe, expect, it } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import {
  projectDelegateChanged,
  projectDelegateVotesChanged,
  ZERO_ADDRESS,
} from './delegation-projector';

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'compound_comp_token',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 3,
  event_type: 'DelegateChanged',
  confirmed_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

describe('delegation-projector', () => {
  it('projects DelegateChanged event', () => {
    const projection = projectDelegateChanged(
      {
        delegator: `0x${'ab'.repeat(20)}`,
        fromDelegate: `0x${'cd'.repeat(20)}`,
        toDelegate: `0x${'ef'.repeat(20)}`,
      },
      ROW,
      { daoId: 'dao-1', delegatorActorId: 'actor-1', delegateActorId: 'actor-2' },
    );

    expect(projection).toEqual({
      dao_id: 'dao-1',
      delegator_actor_id: 'actor-1',
      delegate_actor_id: 'actor-2',
      voting_power: '0',
      block_number: '100',
      tx_hash: '0xtx',
      event_type: 'delegate_changed',
    });
  });

  it('projects DelegateVotesChanged event with self-reference', () => {
    const projection = projectDelegateVotesChanged(
      {
        delegate: `0x${'ef'.repeat(20)}`,
        previousVotes: '10',
        newVotes: '15',
      },
      { ...ROW, event_type: 'DelegateVotesChanged' },
      { daoId: 'dao-1', delegateActorId: 'actor-2' },
    );

    expect(projection).toEqual({
      dao_id: 'dao-1',
      delegator_actor_id: 'actor-2',
      delegate_actor_id: 'actor-2',
      voting_power: '15',
      block_number: '100',
      tx_hash: '0xtx',
      event_type: 'votes_changed',
    });
  });

  it('exports the canonical zero-address constant', () => {
    expect(ZERO_ADDRESS).toBe('0x0000000000000000000000000000000000000000');
  });
});
