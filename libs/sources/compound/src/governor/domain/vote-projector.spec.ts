import { describe, expect, it } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import type { VoteCastPayload } from './types';
import { projectVoteCast } from './vote-projector';

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'compound_governor_bravo',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 3,
  event_type: 'VoteCast',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

const PAYLOAD: VoteCastPayload = {
  voter: `0x${'ab'.repeat(20)}`,
  proposalId: '42',
  primaryChoice: 2,
  votingPowerReported: '123456',
  compound: {
    supportRaw: 2,
    reason: 'because',
  },
};

describe('projectVoteCast', () => {
  it('projects vote and choice rows from VoteCast payload', () => {
    const castAt = new Date('2026-01-01T00:05:00Z');
    const projection = projectVoteCast(PAYLOAD, ROW, {
      castAt,
      daoId: 'dao-1',
      proposalId: 'proposal-1',
      voterAddress: `0x${'ab'.repeat(20)}`,
    });

    expect(projection.vote).toEqual({
      vote_id: 'archive-1',
      dao_id: 'dao-1',
      proposal_id: 'proposal-1',
      voter_address: `0x${'ab'.repeat(20)}`,
      voting_chain_id: '0x1',
      voting_power: '123456',
      cast_at: castAt,
      block_number: '100',
      log_index: 3,
      primary_choice: 2,
      superseded: 0,
      superseded_at: null,
      superseded_by_vote_id: null,
    });
    expect(projection.choice).toEqual({
      choice_index: 2,
      weight: '1.0',
    });
  });
});
