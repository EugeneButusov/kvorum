import type { ArchiveDerivationRow } from '@libs/db';

export interface ActorSweepPayloadRow {
  chain_id: string;
  tx_hash: string;
  log_index: number;
  block_hash: string;
  payload: string;
}

export interface ActorSweepAddressCandidate {
  address: string;
  source: 'voter_event' | 'delegator_event' | 'delegate_event';
}

export interface ActorSweepAdapter {
  sourceTypes: readonly string[];
  eventTypes: readonly string[];
  fetchPayloads(rows: readonly ArchiveDerivationRow[]): Promise<readonly ActorSweepPayloadRow[]>;
  extractAddresses(eventType: string, payloadJson: string): ActorSweepAddressCandidate[];
}
