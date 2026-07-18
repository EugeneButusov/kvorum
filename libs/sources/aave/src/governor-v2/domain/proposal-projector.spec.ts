import { describe, expect, it } from 'vitest';
import { AAVE_V2_CHOICES } from './choices';
import { projectAaveGovernorV2Event, V2ProposalProjectionError } from './proposal-projector';
import type { V2ProjectionArchiveRow } from './proposal-projector';

const CONFIRMED_AT = new Date('2021-01-01T00:00:00Z');

function makeRow(overrides: Partial<V2ProjectionArchiveRow> = {}): V2ProjectionArchiveRow {
  return {
    id: 'archive-row-1',
    dao_source_id: 'source-1',
    source_type: 'aave_governor_v2',
    chain_id: '0x1',
    block_number: '11500000',
    confirmed_at: CONFIRMED_AT,
    ...overrides,
  };
}

describe('projectAaveGovernorV2Event', () => {
  describe('ProposalCreated', () => {
    it('projects a proposal with voting_starts_block and voting_ends_block (not null)', () => {
      const projection = projectAaveGovernorV2Event(
        {
          type: 'ProposalCreated',
          payload: {
            id: '5',
            creator: '0x1111111111111111111111111111111111111111',
            executor: '0x2222222222222222222222222222222222222222',
            targets: ['0x3333333333333333333333333333333333333333'],
            values: ['1000000000000000000'],
            signatures: ['transfer(address,uint256)'],
            calldatas: ['0x1234'],
            withDelegatecalls: [false],
            startBlock: '11500000',
            endBlock: '11550000',
            strategy: '0x4444444444444444444444444444444444444444',
            ipfsHash: '0xaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
          },
        },
        makeRow(),
      );

      expect(projection.kind).toBe('proposal_created');
      if (projection.kind !== 'proposal_created') return;

      // AC #2: voting block numbers must be non-null (not copied from v3 verbatim)
      expect(projection.proposal.voting_starts_block).toBe('11500000');
      expect(projection.proposal.voting_ends_block).toBe('11550000');

      expect(projection.proposal.state).toBe('pending');
      expect(projection.proposal.source_id).toBe('5');
      expect(projection.proposerAddress).toBe('0x1111111111111111111111111111111111111111');

      // IPFS hash: strip 0x prefix, lowercase
      expect(projection.descriptionHash).toBe(
        'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
      );
      expect(projection.proposal.description_hash).toBe(
        'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
      );
    });

    it('projects actions with target_chain_id from archive row chain_id', () => {
      const projection = projectAaveGovernorV2Event(
        {
          type: 'ProposalCreated',
          payload: {
            id: '5',
            creator: '0x1111111111111111111111111111111111111111',
            executor: '0x2222222222222222222222222222222222222222',
            targets: [
              '0xaaaa111111111111111111111111111111111111',
              '0xbbbb111111111111111111111111111111111111',
            ],
            values: ['0', '1000'],
            signatures: ['fn1()', 'fn2(uint256)'],
            calldatas: ['0x', '0x0001'],
            withDelegatecalls: [false, true],
            startBlock: '100',
            endBlock: '200',
            strategy: '0x5555555555555555555555555555555555555555',
            ipfsHash: '0x' + '00'.repeat(32),
          },
        },
        makeRow({ chain_id: '0x1' }),
      );

      if (projection.kind !== 'proposal_created') throw new Error('unexpected kind');
      expect(projection.actions).toHaveLength(2);
      expect(projection.actions[0]).toEqual({
        targetAddress: '0xaaaa111111111111111111111111111111111111',
        targetChainId: '0x1',
        valueWei: '0',
        functionSignature: 'fn1()',
        calldata: '0x',
      });
      expect(projection.actions[1]).toMatchObject({
        targetAddress: '0xbbbb111111111111111111111111111111111111',
        valueWei: '1000',
      });
    });

    it('includes For/Against choices per ADR-039', () => {
      const projection = projectAaveGovernorV2Event(
        {
          type: 'ProposalCreated',
          payload: {
            id: '1',
            creator: '0x1111111111111111111111111111111111111111',
            executor: '0x2222222222222222222222222222222222222222',
            targets: [],
            values: [],
            signatures: [],
            calldatas: [],
            withDelegatecalls: [],
            startBlock: '100',
            endBlock: '200',
            strategy: '0x3333333333333333333333333333333333333333',
            ipfsHash: '0x' + '00'.repeat(32),
          },
        },
        makeRow(),
      );

      if (projection.kind !== 'proposal_created') throw new Error('unexpected kind');
      expect(projection.choices).toEqual(AAVE_V2_CHOICES);
      expect(AAVE_V2_CHOICES[0]).toEqual({ choice_index: 0, value: 'against' });
      expect(AAVE_V2_CHOICES[1]).toEqual({ choice_index: 1, value: 'for' });
    });

    it('sets metadata with voting_chain_id=0x1 and null voting_machine_address', () => {
      const projection = projectAaveGovernorV2Event(
        {
          type: 'ProposalCreated',
          payload: {
            id: '2',
            creator: '0x1111111111111111111111111111111111111111',
            executor: '0x2222222222222222222222222222222222222222',
            targets: [],
            values: [],
            signatures: [],
            calldatas: [],
            withDelegatecalls: [],
            startBlock: '100',
            endBlock: '200',
            strategy: '0x5555555555555555555555555555555555555555',
            ipfsHash: '0x' + '00'.repeat(32),
          },
        },
        makeRow(),
      );

      if (projection.kind !== 'proposal_created') throw new Error('unexpected kind');
      expect(projection.metadata.voting_chain_id).toBe('0x1');
      expect(projection.metadata.voting_machine_address).toBeNull();
      expect(projection.metadata.voting_strategy_address).toBe(
        '0x5555555555555555555555555555555555555555',
      );
    });

    it('throws V2ProposalProjectionError on array length mismatch', () => {
      expect(() =>
        projectAaveGovernorV2Event(
          {
            type: 'ProposalCreated',
            payload: {
              id: '3',
              creator: '0x1111111111111111111111111111111111111111',
              executor: '0x2222222222222222222222222222222222222222',
              targets: ['0x3333333333333333333333333333333333333333'],
              values: ['0', '1'],
              signatures: ['fn()'],
              calldatas: ['0x'],
              withDelegatecalls: [false],
              startBlock: '100',
              endBlock: '200',
              strategy: '0x4444444444444444444444444444444444444444',
              ipfsHash: '0x' + '00'.repeat(32),
            },
          },
          makeRow(),
        ),
      ).toThrow(V2ProposalProjectionError);
    });

    it('throws V2ProposalProjectionError on null confirmed_at', () => {
      expect(() =>
        projectAaveGovernorV2Event(
          {
            type: 'ProposalCreated',
            payload: {
              id: '4',
              creator: '0x1111111111111111111111111111111111111111',
              executor: '0x2222222222222222222222222222222222222222',
              targets: [],
              values: [],
              signatures: [],
              calldatas: [],
              withDelegatecalls: [],
              startBlock: '100',
              endBlock: '200',
              strategy: '0x3333333333333333333333333333333333333333',
              ipfsHash: '0x' + '00'.repeat(32),
            },
          },
          makeRow({ confirmed_at: null }),
        ),
      ).toThrow(V2ProposalProjectionError);
    });
  });

  describe('ProposalQueued', () => {
    it('projects queued state transition', () => {
      const projection = projectAaveGovernorV2Event(
        { type: 'ProposalQueued', payload: { id: '5', executionTime: '1800000000' } },
        makeRow(),
      );

      expect(projection.kind).toBe('proposal_state_transition');
      if (projection.kind !== 'proposal_state_transition') return;
      expect(projection.sourceId).toBe('5');
      expect(projection.targetState).toBe('queued');
      expect(projection.stateUpdatedAt).toEqual(CONFIRMED_AT);
    });
  });

  describe('ProposalExecuted', () => {
    it('projects executed state transition', () => {
      const projection = projectAaveGovernorV2Event(
        { type: 'ProposalExecuted', payload: { id: '6' } },
        makeRow(),
      );

      expect(projection.kind).toBe('proposal_state_transition');
      if (projection.kind !== 'proposal_state_transition') return;
      expect(projection.targetState).toBe('executed');
    });
  });

  describe('ProposalCanceled', () => {
    it('projects canceled state transition', () => {
      const projection = projectAaveGovernorV2Event(
        { type: 'ProposalCanceled', payload: { id: '7' } },
        makeRow(),
      );

      expect(projection.kind).toBe('proposal_state_transition');
      if (projection.kind !== 'proposal_state_transition') return;
      expect(projection.targetState).toBe('canceled');
    });
  });

  describe('VoteEmitted', () => {
    it('throws because VoteEmitted is not a proposal lifecycle event', () => {
      expect(() =>
        projectAaveGovernorV2Event(
          {
            type: 'VoteEmitted',
            payload: {
              id: '5',
              voter: '0xaaaa111111111111111111111111111111111111',
              support: true,
              votingPower: '100',
            },
          },
          makeRow(),
        ),
      ).toThrow();
    });
  });
});
