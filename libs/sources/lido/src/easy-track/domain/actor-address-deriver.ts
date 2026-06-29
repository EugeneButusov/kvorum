import type { ArchiveDerivationRow } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type { ActorAddressDeriver, ActorAddressPayloadRow } from '@sources/core';
import { EasyTrackArchivePayloadRepository } from '../persistence/archive-payload-repository';

// The actor sweep reads `candidate.source` to pick the actor_address source. `'proposer_event'` is the
// value the Aragon vote creator uses — a motion creator is the proposal's proposer.
interface EasyTrackAddressCandidate {
  address: string;
  source: 'proposer_event';
}

/**
 * Actor-address sweep for Lido Easy Track.
 *
 * The projection worker's gate (`findDerivableBy`) only releases archive rows whose
 * `derivation_actor_resolved_at` is stamped, and the sweep stamps a row only for event types an
 * adapter lists — stamping unconditionally even when `extractAddresses` returns `[]`. So this adapter
 * must list every event the motion projection processes.
 *
 * `MotionCreated` carries the motion creator (the proposer). The terminal events (`MotionEnacted`,
 * `MotionRejected`, `MotionCanceled`) are id-only, and `MotionObjected`'s objector is not modeled as a
 * participant (no vote/objection rows in v1) — all four return `[]`, which still lets the sweep mark
 * the row resolved so the projection runs. The settings events (`MotionDurationChanged` etc.) are not
 * listed: they are archive-only reference data, read directly from ClickHouse for the duration lookup.
 */
export class LidoEasyTrackActorAddressDeriver implements ActorAddressDeriver {
  readonly kind = 'actor-address' as const;
  readonly sourceTypes = ['easy_track'] as const;
  readonly eventTypes = [
    'MotionCreated',
    'MotionObjected',
    'MotionEnacted',
    'MotionRejected',
    'MotionCanceled',
  ] as const satisfies readonly ArchiveEventType[];

  constructor(private readonly payloads: EasyTrackArchivePayloadRepository) {}

  async fetchPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<readonly ActorAddressPayloadRow[]> {
    const found = await this.payloads.fetchPayloads(rows);
    return found.map((row) => ({
      chain_id: row.chain_id,
      tx_hash: row.tx_hash,
      log_index: row.log_index,
      block_hash: row.block_hash,
      event_type: row.event_type as ArchiveEventType,
      payload: row.payload,
    }));
  }

  extractAddresses(
    eventType: ArchiveEventType,
    payload: string,
  ): readonly EasyTrackAddressCandidate[] {
    if (eventType === 'MotionCreated') {
      const parsed = JSON.parse(payload) as { creator?: string };
      if (typeof parsed.creator === 'string') {
        return [{ address: parsed.creator.toLowerCase(), source: 'proposer_event' }];
      }
      return [];
    }
    // Terminal events are id-only; an objector is not a modeled participant. [] still lets the sweep
    // mark the row resolved so the projection runs.
    return [];
  }
}
