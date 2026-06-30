import type { ArchiveDerivationRow, OffchainArchiveRow } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';

export const DERIVATION_APPLIERS = 'DERIVATION_APPLIERS';
export const ACTOR_SWEEP_ADAPTERS = 'ACTOR_SWEEP_ADAPTERS';

export interface DerivationProjectionApplier {
  readonly sourceTypes: readonly string[];
  readonly eventTypes: readonly ArchiveEventType[];
  applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void>;
}

/** A row handed to the actor sweep: EVM (block-coord identity) or off-chain (external_id). The
 *  sweep correlates payloads to rows via `archiveRowKey`, which handles both shapes. */
export type ActorSweepRow = ArchiveDerivationRow | OffchainArchiveRow;

/** A CH payload slice correlated back to its archive row by `archiveRowKey`. One of two shapes —
 *  off-chain rows carry the source-native `external_id`; EVM rows carry the block 4-tuple — so each
 *  variant keeps its own identity invariant rather than degrading to a bag of optionals. */
export type ActorSweepPayloadRow =
  | { external_id: string; event_type: ArchiveEventType; payload: string }
  | {
      chain_id: string;
      tx_hash: string;
      log_index: number;
      block_hash: string;
      event_type: ArchiveEventType;
      payload: string;
    };

export interface ActorSweepAddressCandidate {
  address: string;
  source: string;
}

/** The sweep's single normalized adapter. Per-source derivers (EVM `ActorAddressDeriver`,
 *  off-chain `OffchainActorAddressDeriver`) are mapped onto this shape at the composition root, so
 *  the sweep service has one code path regardless of transport. */
export interface ActorSweepAdapter {
  readonly sourceTypes: readonly string[];
  readonly eventTypes: readonly ArchiveEventType[];
  fetchPayloads(rows: readonly ActorSweepRow[]): Promise<readonly ActorSweepPayloadRow[]>;
  extractAddresses(
    eventType: ArchiveEventType,
    payload: string,
  ): readonly ActorSweepAddressCandidate[];
}
