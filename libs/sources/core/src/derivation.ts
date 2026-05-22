import type { ArchiveDerivationRow } from '@libs/db';

export const DERIVATION_APPLIERS = 'DERIVATION_APPLIERS';
export const ACTOR_SWEEP_ADAPTERS = 'ACTOR_SWEEP_ADAPTERS';

export interface DerivationProjectionApplier {
  readonly sourceTypes: readonly string[];
  readonly eventTypes: readonly string[];
  applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void>;
}

export interface ActorSweepPayloadRow {
  chain_id: string;
  tx_hash: string;
  log_index: number;
  block_hash: string;
  event_type: string;
  payload: string;
}

export interface ActorSweepAddressCandidate {
  address: string;
  source: string;
}

export interface ActorSweepAdapter {
  readonly sourceTypes: readonly string[];
  readonly eventTypes: readonly string[];
  fetchPayloads(rows: readonly ArchiveDerivationRow[]): Promise<readonly ActorSweepPayloadRow[]>;
  extractAddresses(eventType: string, payload: string): readonly ActorSweepAddressCandidate[];
}
