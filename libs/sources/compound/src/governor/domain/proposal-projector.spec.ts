import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ProposalProjectionError,
  projectCompoundProposalEvent,
  type CompoundProjectionArchiveRow,
} from './proposal-projector';
import type { CompoundGovernorEvent, ProposalCreatedPayload } from './types';

const CONFIRMED_AT = new Date('2026-01-01T00:00:00Z');

const ARCHIVE_ROW: CompoundProjectionArchiveRow = {
  id: 'archive-row-1',
  dao_source_id: 'dao-source-1',
  source_type: 'compound_governor_bravo',
  chain_id: '0x1',
  confirmed_at: CONFIRMED_AT,
};

const CREATED_PAYLOAD: ProposalCreatedPayload = {
  proposalId: '42',
  proposer: '0xABCDEF',
  targets: ['0xTargetA', '0xTargetB'],
  values: ['0', '10'],
  signatures: ['_setPendingAdmin(address)', ''],
  calldatas: ['0x1234', '0xabcd'],
  startBlock: '200',
  endBlock: '300',
  description: '# Proposal 42\nBody',
};

describe('projectCompoundProposalEvent', () => {
  it('projects ProposalCreated into insertable proposal data, actions, and ADR-039 choices', () => {
    const projection = projectCompoundProposalEvent(
      { type: 'ProposalCreated', payload: CREATED_PAYLOAD },
      ARCHIVE_ROW,
    );

    expect(projection.kind).toBe('proposal_created');
    if (projection.kind !== 'proposal_created') throw new Error('wrong projection kind');

    expect(projection.proposerAddress).toBe('0xabcdef');
    expect(projection.proposal).toMatchObject({
      source_type: 'compound_governor_bravo',
      source_id: '42',
      title: 'Proposal 42',
      description: '# Proposal 42\nBody',
      description_hash: createHash('sha256').update('# Proposal 42\nBody').digest('hex'),
      binding: true,
      voting_starts_at: null,
      voting_ends_at: null,
      voting_starts_block: '200',
      voting_ends_block: '300',
      voting_power_block: '200',
      state: 'pending',
      state_updated_at: CONFIRMED_AT,
      updated_at: CONFIRMED_AT,
    });
    expect(projection.actions).toEqual([
      {
        targetAddress: '0xTargetA',
        targetChainId: '0x1',
        valueWei: '0',
        functionSignature: '_setPendingAdmin(address)',
        calldata: '0x1234',
      },
      {
        targetAddress: '0xTargetB',
        targetChainId: '0x1',
        valueWei: '10',
        functionSignature: '',
        calldata: '0xabcd',
      },
    ]);
    expect(projection.choices).toEqual([
      { proposal_id: '', choice_index: 0, value: 'Against' },
      { proposal_id: '', choice_index: 1, value: 'For' },
      { proposal_id: '', choice_index: 2, value: 'Abstain' },
    ]);
  });

  it('is deterministic for idempotent replay of the same ProposalCreated event', () => {
    const event: CompoundGovernorEvent = { type: 'ProposalCreated', payload: CREATED_PAYLOAD };

    expect(projectCompoundProposalEvent(event, ARCHIVE_ROW)).toEqual(
      projectCompoundProposalEvent(event, ARCHIVE_ROW),
    );
  });

  it.each([
    [{ type: 'ProposalQueued', payload: { proposalId: '42', eta: '1700000000' } }, 'queued'],
    [{ type: 'ProposalExecuted', payload: { proposalId: '42' } }, 'executed'],
    [{ type: 'ProposalCanceled', payload: { proposalId: '42' } }, 'canceled'],
  ] as const)('projects %s into a guarded state transition target', (event, targetState) => {
    expect(projectCompoundProposalEvent(event, ARCHIVE_ROW)).toEqual({
      kind: 'proposal_state_transition',
      archiveRowId: 'archive-row-1',
      daoSourceId: 'dao-source-1',
      sourceType: 'compound_governor_bravo',
      sourceId: '42',
      targetState,
      stateUpdatedAt: CONFIRMED_AT,
      eta: targetState === 'queued' ? new Date('2023-11-14T22:13:20.000Z') : undefined,
    });
  });

  it('leaves out-of-order Executed-before-Queued handling to the repository state guard', () => {
    const executed = projectCompoundProposalEvent(
      { type: 'ProposalExecuted', payload: { proposalId: '42' } },
      ARCHIVE_ROW,
    );
    const queued = projectCompoundProposalEvent(
      { type: 'ProposalQueued', payload: { proposalId: '42', eta: '1700000000' } },
      ARCHIVE_ROW,
    );

    expect(executed.kind).toBe('proposal_state_transition');
    expect(queued.kind).toBe('proposal_state_transition');
    if (
      executed.kind !== 'proposal_state_transition' ||
      queued.kind !== 'proposal_state_transition'
    ) {
      throw new Error('wrong projection kind');
    }

    expect(executed.targetState).toBe('executed');
    expect(queued.targetState).toBe('queued');
  });

  it('throws when a confirmed archive row is missing confirmed_at', () => {
    expect(() =>
      projectCompoundProposalEvent(
        { type: 'ProposalQueued', payload: { proposalId: '42', eta: '1700000000' } },
        { ...ARCHIVE_ROW, confirmed_at: null },
      ),
    ).toThrow(ProposalProjectionError);
  });

  it('throws on malformed ProposalCreated action arrays', () => {
    expect(() =>
      projectCompoundProposalEvent(
        {
          type: 'ProposalCreated',
          payload: {
            ...CREATED_PAYLOAD,
            values: ['0'],
          },
        },
        ARCHIVE_ROW,
      ),
    ).toThrow(ProposalProjectionError);
  });
});
