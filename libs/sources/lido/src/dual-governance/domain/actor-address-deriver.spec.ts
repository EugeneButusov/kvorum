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
  it('claims dual_governance + DualGovernanceStateChanged so the sweep stamps it resolved', () => {
    const { deriver } = makeDeriver();
    expect(deriver.kind).toBe('actor-address');
    expect(deriver.sourceTypes).toEqual(['dual_governance']);
    expect(deriver.eventTypes).toEqual(['DualGovernanceStateChanged']);
  });

  it('extracts no actor candidates (a state transition has no participant)', () => {
    const { deriver } = makeDeriver();
    expect(
      deriver.extractAddresses('DualGovernanceStateChanged', '{"from":"NotInitialized"}'),
    ).toEqual([]);
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
