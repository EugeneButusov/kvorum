import type { OffchainArchiveRow } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type {
  ActorAddressCandidate,
  OffchainActorAddressDeriver,
  OffchainActorAddressPayloadRow,
} from '@sources/core';
import type { SnapshotProposalPayload } from './types';
import type { SnapshotArchivePayloadRepository } from '../persistence/archive-payload-repository';

// Minimal AD2 actor adapter: resolves the proposer (`author`) from SnapshotProposalCreated so the
// proposal row passes the actor-resolution gate before derivation. AD3 extends this to voters
// (SnapshotVoteCast) and delegators.
export class SnapshotActorAddressDeriver implements OffchainActorAddressDeriver {
  readonly kind = 'offchain-actor-address' as const;
  readonly sourceTypes = ['snapshot'] as const;
  readonly eventTypes = ['SnapshotProposalCreated'] as const;

  constructor(private readonly payloads: SnapshotArchivePayloadRepository) {}

  async fetchPayloads(
    rows: readonly OffchainArchiveRow[],
  ): Promise<readonly OffchainActorAddressPayloadRow[]> {
    const latest = await this.payloads.fetchLatest(rows);
    const eventTypeByExternalId = new Map(rows.map((row) => [row.external_id, row.event_type]));
    return latest.map((row) => ({
      external_id: row.external_id,
      event_type: eventTypeByExternalId.get(row.external_id) ?? 'SnapshotProposalCreated',
      payload: row.payload,
    }));
  }

  extractAddresses(eventType: ArchiveEventType, payload: string): readonly ActorAddressCandidate[] {
    if (eventType !== 'SnapshotProposalCreated') return [];
    const parsed = JSON.parse(payload) as SnapshotProposalPayload;
    if (parsed.author == null || parsed.author === '') return [];
    return [{ address: parsed.author, role: 'proposer_event' }];
  }
}
