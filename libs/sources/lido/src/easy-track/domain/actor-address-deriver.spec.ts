import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { LidoEasyTrackActorAddressDeriver } from './actor-address-deriver';
import { EasyTrackArchivePayloadRepository } from '../persistence/archive-payload-repository';

const CREATOR = '0xAbCAbCAbCaBCaBcAbcAbCABcabcAbCAbcABcAbCaB';

function makeDeriver(payloadRows: Array<Record<string, unknown>> = []) {
  const payloads = {
    fetchPayloads: vi.fn().mockResolvedValue(payloadRows),
  } as unknown as EasyTrackArchivePayloadRepository;
  return new LidoEasyTrackActorAddressDeriver(payloads);
}

describe('LidoEasyTrackActorAddressDeriver', () => {
  it('is an actor-address adapter for easy_track listing the five lifecycle events', () => {
    const deriver = makeDeriver();
    expect(deriver.kind).toBe('actor-address');
    expect(deriver.sourceTypes).toEqual(['easy_track']);
    expect([...deriver.eventTypes].sort()).toEqual([
      'MotionCanceled',
      'MotionCreated',
      'MotionEnacted',
      'MotionObjected',
      'MotionRejected',
    ]);
  });

  it('extracts the lowercased creator from MotionCreated as a proposer', () => {
    const deriver = makeDeriver();
    expect(deriver.extractAddresses('MotionCreated', JSON.stringify({ creator: CREATOR }))).toEqual(
      [{ address: CREATOR.toLowerCase(), source: 'proposer_event' }],
    );
  });

  it('returns [] for MotionCreated without a creator', () => {
    const deriver = makeDeriver();
    expect(deriver.extractAddresses('MotionCreated', JSON.stringify({}))).toEqual([]);
  });

  it('returns [] for terminal + objection events (objectors are not modeled participants)', () => {
    const deriver = makeDeriver();
    for (const event of [
      'MotionObjected',
      'MotionEnacted',
      'MotionRejected',
      'MotionCanceled',
    ] as const) {
      expect(deriver.extractAddresses(event, JSON.stringify({ motionId: '1' }))).toEqual([]);
    }
  });

  it('fetchPayloads maps archive rows into actor-sweep payload rows', async () => {
    const deriver = makeDeriver([
      {
        chain_id: '0x1',
        tx_hash: '0xtx',
        log_index: 3,
        block_hash: '0xbh',
        event_type: 'MotionCreated',
        payload: '{}',
        received_at: new Date(),
      },
    ]);
    const out = await deriver.fetchPayloads([{ id: 'r1' } as unknown as ArchiveDerivationRow]);
    expect(out).toEqual([
      {
        chain_id: '0x1',
        tx_hash: '0xtx',
        log_index: 3,
        block_hash: '0xbh',
        event_type: 'MotionCreated',
        payload: '{}',
      },
    ]);
  });
});
