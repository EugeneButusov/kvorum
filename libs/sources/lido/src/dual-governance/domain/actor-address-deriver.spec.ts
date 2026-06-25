import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { LidoDualGovernanceActorAddressDeriver } from './actor-address-deriver';
import type { DualGovernanceArchivePayloadRepository } from '../persistence/archive-payload-repository';

function makeDeriver(payloadRows: unknown[] = []) {
  const payloads = {
    fetchPayloads: vi.fn().mockResolvedValue(payloadRows),
  } as unknown as DualGovernanceArchivePayloadRepository;
  return { deriver: new LidoDualGovernanceActorAddressDeriver(payloads), payloads };
}

describe('LidoDualGovernanceActorAddressDeriver', () => {
  it('claims dual_governance + every event the projections derive so the sweep stamps them', () => {
    const { deriver } = makeDeriver();
    expect(deriver.kind).toBe('actor-address');
    expect(deriver.sourceTypes).toEqual(['dual_governance']);
    expect(deriver.eventTypes).toEqual([
      'DualGovernanceStateChanged',
      'ProposalSubmitted',
      'ProposalScheduled',
      'ProposalExecuted',
      'ProposalsCancelledTill',
      'ProposalSubmittedMeta',
    ]);
  });

  it('extracts no actor candidates for a state transition', () => {
    const { deriver } = makeDeriver();
    expect(
      deriver.extractAddresses('DualGovernanceStateChanged', '{"from":"NotInitialized"}'),
    ).toEqual([]);
  });

  it('extracts the proposer from ProposalSubmittedMeta (lowercased, proposer_event)', () => {
    const { deriver } = makeDeriver();
    const proposer = '0xABCdef0000000000000000000000000000000001';
    expect(
      deriver.extractAddresses(
        'ProposalSubmittedMeta',
        JSON.stringify({ proposerAccount: proposer, proposalId: '7', metadata: 'x' }),
      ),
    ).toEqual([{ address: proposer.toLowerCase(), source: 'proposer_event' }]);
  });

  it('extracts no candidate when ProposalSubmittedMeta lacks a proposer', () => {
    const { deriver } = makeDeriver();
    expect(deriver.extractAddresses('ProposalSubmittedMeta', '{}')).toEqual([]);
  });

  it('extracts no candidates for the Timelock id-only / calls events (executor is a contract)', () => {
    const { deriver } = makeDeriver();
    expect(deriver.extractAddresses('ProposalSubmitted', JSON.stringify({ id: '7' }))).toEqual([]);
    expect(deriver.extractAddresses('ProposalScheduled', JSON.stringify({ id: '7' }))).toEqual([]);
    expect(deriver.extractAddresses('ProposalsCancelledTill', '{"proposalId":"7"}')).toEqual([]);
  });

  it('maps fetched CH payload rows to the ActorAddressPayloadRow shape', async () => {
    const chRow = {
      chain_id: '0x1',
      tx_hash: '0x' + 'cd'.repeat(32),
      log_index: 2,
      block_hash: '0x' + 'ab'.repeat(32),
      event_type: 'DualGovernanceStateChanged',
      payload: '{}',
      received_at: new Date(),
    };
    const { deriver, payloads } = makeDeriver([chRow]);
    const rows = [{ id: 'r1' }] as unknown as ArchiveDerivationRow[];
    const out = await deriver.fetchPayloads(rows);
    expect(payloads.fetchPayloads).toHaveBeenCalledWith(rows);
    expect(out).toEqual([
      {
        chain_id: '0x1',
        tx_hash: chRow.tx_hash,
        log_index: 2,
        block_hash: chRow.block_hash,
        event_type: 'DualGovernanceStateChanged',
        payload: '{}',
      },
    ]);
  });
});
