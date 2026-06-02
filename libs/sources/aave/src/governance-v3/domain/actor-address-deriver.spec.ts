import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { AaveGovernanceActorAddressDeriver } from './actor-address-deriver';

const ROW: ArchiveDerivationRow = {
  id: 'archive-1',
  source_type: 'aave_governance_v3',
  dao_source_id: 'source-1',
  chain_id: '0x1',
  block_number: '100',
  block_hash: '0xblock',
  tx_hash: '0xtx',
  log_index: 1,
  event_type: 'ProposalCreated',
  received_at: new Date('2026-01-01T00:00:00Z'),
  derivation_attempt_count: 0,
};

describe('AaveGovernanceActorAddressDeriver', () => {
  it('delegates payload lookup to the archive payload repository', async () => {
    const payloads = [{ payload: '{}' }];
    const repo = { fetchPayloads: vi.fn().mockResolvedValue(payloads) };
    const deriver = new AaveGovernanceActorAddressDeriver(repo as never);

    await expect(deriver.fetchPayloads([ROW])).resolves.toEqual(payloads);
    expect(repo.fetchPayloads).toHaveBeenCalledWith([ROW]);
  });

  it('extracts the creator from ProposalCreated payloads', () => {
    const deriver = new AaveGovernanceActorAddressDeriver({ fetchPayloads: vi.fn() } as never);
    expect(
      deriver.extractAddresses(
        'ProposalCreated',
        JSON.stringify({ creator: '0x1111111111111111111111111111111111111111' }),
      ),
    ).toEqual([
      { address: '0x1111111111111111111111111111111111111111', source: 'proposer_event' },
    ]);
  });

  it('returns no addresses for non-create events', () => {
    const deriver = new AaveGovernanceActorAddressDeriver({ fetchPayloads: vi.fn() } as never);
    expect(
      deriver.extractAddresses('ProposalQueued', JSON.stringify({ proposalId: '101' })),
    ).toEqual([]);
  });

  it('throws when ProposalCreated.creator is invalid', () => {
    const deriver = new AaveGovernanceActorAddressDeriver({ fetchPayloads: vi.fn() } as never);
    expect(() =>
      deriver.extractAddresses('ProposalCreated', JSON.stringify({ creator: 'not-an-address' })),
    ).toThrow('invalid ProposalCreated.creator payload field');
  });
});
