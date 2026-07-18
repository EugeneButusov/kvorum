import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AragonProposalProjectionError,
  projectAragonProposalEvent,
  type AragonProjectionArchiveRow,
} from './proposal-projector';
import type { AragonVotingEvent } from './types';

const CONFIRMED_AT = new Date('2026-01-01T00:00:00Z');

const ARCHIVE_ROW: AragonProjectionArchiveRow = {
  id: 'archive-row-1',
  dao_source_id: 'dao-source-1',
  source_type: 'aragon_voting',
  chain_id: '0x1',
  block_number: '12345',
  confirmed_at: CONFIRMED_AT,
};

describe('projectAragonProposalEvent', () => {
  it('projects StartVote into an active proposal with title and binary choices', () => {
    const event: AragonVotingEvent = {
      type: 'StartVote',
      payload: {
        voteId: '170',
        creator: '0xABCDEF0000000000000000000000000000000001',
        metadata: 'Omnibus vote: do A;',
      },
    };

    const projection = projectAragonProposalEvent(event, ARCHIVE_ROW);
    expect(projection.kind).toBe('proposal_created');
    if (projection.kind !== 'proposal_created') return;

    expect(projection.sourceId).toBe('170');
    expect(projection.creatorAddress).toBe('0xabcdef0000000000000000000000000000000001');
    expect(projection.proposal.state).toBe('active');
    expect(projection.proposal.binding).toBe(true);
    expect(projection.proposal.title).toBe('Omnibus vote: do A;');
    expect(projection.proposal.description).toBe('Omnibus vote: do A;');
    expect(projection.proposal.description_hash).toBe(
      createHash('sha256').update('Omnibus vote: do A;').digest('hex'),
    );
    expect(projection.proposal.voting_starts_block).toBe('12345');
    expect(projection.proposal.voting_ends_block).toBeNull();
    expect(projection.choices).toEqual([
      { proposal_id: '', choice_index: 0, value: 'no' },
      { proposal_id: '', choice_index: 1, value: 'yes' },
    ]);
  });

  it('uses a placeholder title for empty StartVote metadata', () => {
    const projection = projectAragonProposalEvent(
      { type: 'StartVote', payload: { voteId: '5', creator: '0x' + '1'.repeat(40), metadata: '' } },
      ARCHIVE_ROW,
    );
    if (projection.kind !== 'proposal_created') throw new Error('expected proposal_created');
    expect(projection.proposal.title).toBe('Lido Vote #5');
    expect(projection.proposal.description).toBe('');
  });

  it('projects ExecuteVote into an executed state transition with executedAt', () => {
    const projection = projectAragonProposalEvent(
      { type: 'ExecuteVote', payload: { voteId: '170' } },
      ARCHIVE_ROW,
    );
    expect(projection.kind).toBe('state_transition');
    if (projection.kind !== 'state_transition') return;
    expect(projection.targetState).toBe('executed');
    expect(projection.sourceId).toBe('170');
    expect(projection.executedAt).toEqual(CONFIRMED_AT);
  });

  it('projects each Change* config event into a no-op drain', () => {
    const events: AragonVotingEvent[] = [
      { type: 'ChangeSupportRequired', payload: { supportRequiredPct: '500000000000000000' } },
      { type: 'ChangeMinQuorum', payload: { minAcceptQuorumPct: '50000000000000000' } },
      { type: 'ChangeVoteTime', payload: { voteTime: '259200' } },
      { type: 'ChangeObjectionPhaseTime', payload: { objectionPhaseTime: '86400' } },
    ];
    for (const event of events) {
      expect(projectAragonProposalEvent(event, ARCHIVE_ROW).kind).toBe('config_noop');
    }
  });

  it('throws when confirmed_at is missing', () => {
    expect(() =>
      projectAragonProposalEvent(
        {
          type: 'StartVote',
          payload: { voteId: '1', creator: '0x' + '2'.repeat(40), metadata: 'x' },
        },
        { ...ARCHIVE_ROW, confirmed_at: null },
      ),
    ).toThrow(AragonProposalProjectionError);
  });

  it('refuses to project vote events as proposal lifecycle', () => {
    expect(() =>
      projectAragonProposalEvent(
        {
          type: 'CastVote',
          payload: { voteId: '1', voter: '0x' + '3'.repeat(40), supports: true, stake: '1' },
        },
        ARCHIVE_ROW,
      ),
    ).toThrow();
  });
});
