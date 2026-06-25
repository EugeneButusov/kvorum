import type { ArchiveDerivationRow } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type {
  ActorAddressCandidate,
  ActorAddressDeriver,
  ActorAddressPayloadRow,
} from '@sources/core';
import { DualGovernanceArchivePayloadRepository } from '../persistence/archive-payload-repository';

/**
 * Actor-address sweep for Lido Dual Governance.
 *
 * The projection worker's gate (`findDerivableBy`) only releases archive rows whose
 * `derivation_actor_resolved_at` is stamped, and the actor sweep stamps a row only for event types an
 * adapter lists — stamping unconditionally even when `extractAddresses` returns `[]`. So this adapter
 * must list every event the DG projection processes.
 *
 * AB2 processes only `DualGovernanceStateChanged`, which has no governance actor (a transition is not
 * attributable to a voter/proposer), so `extractAddresses` returns `[]` — the sweep still marks the row
 * resolved, letting the state-history applier run. AB3 EXTENDS `eventTypes` (and the switch) for the
 * proposer/proposal events it derives.
 */
export class LidoDualGovernanceActorAddressDeriver implements ActorAddressDeriver {
  readonly kind = 'actor-address' as const;
  readonly sourceTypes = ['dual_governance'] as const;
  readonly eventTypes = [
    'DualGovernanceStateChanged',
  ] as const satisfies readonly ArchiveEventType[];

  constructor(private readonly payloads: DualGovernanceArchivePayloadRepository) {}

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
    _eventType: ArchiveEventType,
    _payload: string,
  ): readonly ActorAddressCandidate[] {
    // No governance actor on a state transition. The escrow/config addresses in the payload are
    // contracts, not participants. Returning [] still lets the sweep mark the row resolved.
    return [];
  }
}
