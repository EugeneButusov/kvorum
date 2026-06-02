import { describe, expect, it } from 'vitest';
import { projectAaveGovernanceV3Event, AaveProposalProjectionError } from './proposal-projector';
import type { AaveGovernanceV3Event } from './types';

const ARCHIVE_ROW = {
  id: 'archive-1',
  dao_source_id: 'source-1',
  source_type: 'aave_governance_v3',
  chain_id: '0x1',
  block_number: '123',
  confirmed_at: new Date('2026-01-01T00:00:00Z'),
};

describe('projectAaveGovernanceV3Event', () => {
  it('projects ProposalCreated with placeholder content and metadata', () => {
    const event: AaveGovernanceV3Event = {
      type: 'ProposalCreated',
      payload: {
        proposalId: '101',
        creator: '0x' + '11'.repeat(20),
        accessLevel: 2,
        ipfsHash: '0x' + '12'.repeat(32),
      },
    };

    const projection = projectAaveGovernanceV3Event(event, ARCHIVE_ROW);
    expect(projection.kind).toBe('proposal_created');
    if (projection.kind !== 'proposal_created') return;
    expect(projection.descriptionHash).toBe('12'.repeat(32));
    expect(projection.proposal).toMatchObject({
      source_id: '101',
      title: 'Proposal #101',
      description: '',
      description_hash: '12'.repeat(32),
      voting_power_block: '123',
      state: 'pending',
    });
    expect(projection.metadata).toMatchObject({
      voting_chain_id: null,
      voting_machine_address: null,
      snapshot_block_hash: null,
      creation_block: '123',
    });
    expect(projection.choices).toEqual([
      { choice_index: 0, value: 'Against' },
      { choice_index: 1, value: 'For' },
    ]);
  });

  it('projects VotingActivated into active state with snapshot hash', () => {
    const projection = projectAaveGovernanceV3Event(
      {
        type: 'VotingActivated',
        payload: {
          proposalId: '101',
          snapshotBlockHash: '0x' + '34'.repeat(32),
          votingDuration: 86400,
        },
      },
      ARCHIVE_ROW,
    );

    expect(projection).toMatchObject({
      kind: 'voting_activated',
      sourceId: '101',
      snapshotBlockHash: '0x' + '34'.repeat(32),
      targetState: 'active',
    });
  });

  it('projects PayloadSent into declared payload metadata', () => {
    const projection = projectAaveGovernanceV3Event(
      {
        type: 'PayloadSent',
        payload: {
          proposalId: '101',
          payloadId: '55',
          payloadsController: '0x' + '22'.repeat(20),
          chainId: '137',
          payloadNumberOnProposal: '1',
          numberOfPayloadsOnProposal: '3',
        },
      },
      ARCHIVE_ROW,
    );

    expect(projection).toMatchObject({
      kind: 'payload_declared',
      sourceId: '101',
      payload: {
        payload_index: 1,
        target_chain_id: '137',
        payloads_controller_address: '0x' + '22'.repeat(20),
        payload_id: '55',
        status: 'declared',
      },
    });
  });

  it('throws when confirmed_at is missing', () => {
    expect(() =>
      projectAaveGovernanceV3Event(
        { type: 'ProposalExecuted', payload: { proposalId: '101' } },
        { ...ARCHIVE_ROW, confirmed_at: null },
      ),
    ).toThrowError(new AaveProposalProjectionError('missing_confirmed_at', 'archive-1'));
  });
});
