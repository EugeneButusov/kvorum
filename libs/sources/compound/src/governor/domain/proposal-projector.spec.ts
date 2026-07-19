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
  block_number: '12345',
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
  it('repairs a description whose newlines arrived escaped, so the title is not the whole body', () => {
    // Observed on Compound proposal 591: the proposer submitted the description JSON-encoded, so
    // every newline is the literal two characters \\ and n. Left alone, the markdown renders as one
    // blob and extractCompoundTitle (which splits on newlines) swallows the entire description.
    const escaped =
      '# Deprecation of Polygon Comets\\n## Simple Summary\\n\\nGauntlet recommends changes.';
    const projection = projectCompoundProposalEvent(
      { type: 'ProposalCreated', payload: { ...CREATED_PAYLOAD, description: escaped } },
      ARCHIVE_ROW,
    );
    if (projection.kind !== 'proposal_created') throw new Error('wrong projection kind');

    const repaired =
      '# Deprecation of Polygon Comets\n## Simple Summary\n\nGauntlet recommends changes.';
    expect(projection.proposal.title).toBe('Deprecation of Polygon Comets');
    expect(projection.proposal.description).toBe(repaired);
    // The hash covers what we store, not the escaped original.
    expect(projection.proposal.description_hash).toBe(
      createHash('sha256').update(repaired).digest('hex'),
    );
  });

  it('leaves a healthy description byte-for-byte alone', () => {
    const healthy = '# Proposal 42\nBody with real newlines.';
    const projection = projectCompoundProposalEvent(
      { type: 'ProposalCreated', payload: { ...CREATED_PAYLOAD, description: healthy } },
      ARCHIVE_ROW,
    );
    if (projection.kind !== 'proposal_created') throw new Error('wrong projection kind');

    expect(projection.proposal.description).toBe(healthy);
    expect(projection.proposal.title).toBe('Proposal 42');
  });

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
      { proposal_id: '', choice_index: 0, value: 'against' },
      { proposal_id: '', choice_index: 1, value: 'for' },
      { proposal_id: '', choice_index: 2, value: 'abstain' },
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
      queuedAtBlock: targetState === 'queued' ? '12345' : undefined,
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
