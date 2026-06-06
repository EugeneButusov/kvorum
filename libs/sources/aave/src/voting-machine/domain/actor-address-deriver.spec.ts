import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { AaveVotingMachineActorAddressDeriver } from './actor-address-deriver';

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'aave_voting_machine',
  dao_source_id: 'source-1',
  chain_id: '0x89',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'VoteEmitted',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

describe('AaveVotingMachineActorAddressDeriver', () => {
  it('delegates payload lookup to the archive payload repository', async () => {
    const payloads = [{ payload: '{}' }];
    const repo = { fetchPayloads: vi.fn().mockResolvedValue(payloads) };
    const deriver = new AaveVotingMachineActorAddressDeriver(repo as never);

    await expect(deriver.fetchPayloads([ROW])).resolves.toEqual(payloads);
    expect(repo.fetchPayloads).toHaveBeenCalledWith([ROW]);
  });

  it('extracts the voter from VoteEmitted payloads', () => {
    const deriver = new AaveVotingMachineActorAddressDeriver({ fetchPayloads: vi.fn() } as never);

    expect(
      deriver.extractAddresses(
        'VoteEmitted',
        JSON.stringify({ voter: '0x1111111111111111111111111111111111111111' }),
      ),
    ).toEqual([{ address: '0x1111111111111111111111111111111111111111', source: 'voter_event' }]);
  });

  it.each([
    'ProposalVoteStarted',
    'ProposalResultsSent',
    'ProposalVoteConfigurationBridged',
  ] as const)('returns no addresses for %s events', (eventType) => {
    const deriver = new AaveVotingMachineActorAddressDeriver({ fetchPayloads: vi.fn() } as never);

    expect(deriver.extractAddresses(eventType, JSON.stringify({ proposalId: '101' }))).toEqual([]);
  });

  it('throws when VoteEmitted.voter is invalid', () => {
    const deriver = new AaveVotingMachineActorAddressDeriver({ fetchPayloads: vi.fn() } as never);

    expect(() =>
      deriver.extractAddresses('VoteEmitted', JSON.stringify({ voter: 'not-an-address' })),
    ).toThrow('invalid VoteEmitted.voter payload field');
  });

  it('registers the expected source and event types', () => {
    const deriver = new AaveVotingMachineActorAddressDeriver({ fetchPayloads: vi.fn() } as never);

    expect(deriver.sourceTypes).toEqual(['aave_voting_machine']);
    expect(deriver.eventTypes).toEqual([
      'VoteEmitted',
      'ProposalVoteStarted',
      'ProposalResultsSent',
      'ProposalVoteConfigurationBridged',
    ]);
  });
});
