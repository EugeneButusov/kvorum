import { describe, expect, it } from 'vitest';
import type { ArchiveDerivationRow, CurrentVoteRow } from '@libs/db';
import { buildVoteRows, isNewerVote } from './vote-rows';

const BASE_ROW: ArchiveDerivationRow = {
  id: 'archive-2',
  source_type: 'test_vote_source',
  dao_source_id: 'source-1',
  chain_id: '0x89',
  block_number: '200',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 3,
  event_type: 'VoteRecorded',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

const CURRENT: CurrentVoteRow = {
  vote_id: 'archive-1',
  cast_at: new Date('2026-01-01T00:01:39Z'),
  block_number: '199',
  log_index: 2,
  primary_choice: 0,
  voting_power: '100',
  voting_chain_id: '0x89',
};

describe('isNewerVote', () => {
  it('treats missing current vote as newer', () => {
    expect(isNewerVote(new Date('2026-01-01T00:01:40Z'), '200', 3, undefined)).toBe(true);
  });

  it('orders by cast timestamp, then block number, then log index', () => {
    expect(isNewerVote(new Date('2026-01-01T00:01:41Z'), '100', 1, CURRENT)).toBe(true);
    expect(isNewerVote(new Date('2026-01-01T00:01:39Z'), '200', 1, CURRENT)).toBe(true);
    expect(isNewerVote(new Date('2026-01-01T00:01:39Z'), '199', 3, CURRENT)).toBe(true);
    expect(isNewerVote(new Date('2026-01-01T00:01:39Z'), '199', 2, CURRENT)).toBe(false);
  });
});

describe('buildVoteRows', () => {
  it('builds one current row when incoming vote is newest and there is no current vote', () => {
    const rows = buildVoteRows({
      row: BASE_ROW,
      daoId: 'dao-1',
      proposalId: 'proposal-1',
      voterAddress: '0xabc',
      castAt: new Date('2026-01-01T00:01:40Z'),
      incoming: { primaryChoice: 1, votingPower: '123' },
      current: undefined,
      incomingIsNewer: true,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        vote_id: 'archive-2',
        voting_chain_id: '0x89',
        primary_choice: 1,
        voting_power: '123',
        superseded: 0,
        superseded_at: null,
        superseded_by_vote_id: null,
      }),
    ]);
  });

  it('supersedes the prior current vote when the incoming row is newer', () => {
    const castAt = new Date('2026-01-01T00:01:40Z');
    const rows = buildVoteRows({
      row: BASE_ROW,
      daoId: 'dao-1',
      proposalId: 'proposal-1',
      voterAddress: '0xabc',
      castAt,
      incoming: { primaryChoice: 1, votingPower: '123' },
      current: CURRENT,
      incomingIsNewer: true,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        vote_id: 'archive-2',
        superseded: 0,
      }),
      expect.objectContaining({
        vote_id: 'archive-1',
        voting_chain_id: '0x89',
        superseded: 1,
        superseded_at: castAt,
        superseded_by_vote_id: 'archive-2',
      }),
    ]);
  });

  it('marks the incoming row superseded when it loses ordering', () => {
    const rows = buildVoteRows({
      row: BASE_ROW,
      daoId: 'dao-1',
      proposalId: 'proposal-1',
      voterAddress: '0xabc',
      castAt: new Date('2026-01-01T00:01:38Z'),
      incoming: { primaryChoice: 1, votingPower: '123' },
      current: CURRENT,
      incomingIsNewer: false,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        vote_id: 'archive-2',
        superseded: 1,
        superseded_by_vote_id: 'archive-1',
      }),
    ]);
  });
});
