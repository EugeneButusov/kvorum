import type { OffchainArchiveRow } from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import type {
  ActorAddressCandidate,
  OffchainActorAddressDeriver,
  OffchainActorAddressPayloadRow,
} from '@sources/core';
import type { SnapshotProposalPayload, SnapshotVotePayload } from './types';
import type { SnapshotArchivePayloadRepository } from '../persistence/archive-payload-repository';

// Resolves the actor addresses Snapshot derivation gates on: the proposer (`author`) from
// SnapshotProposalCreated and the voter (`voter`) from SnapshotVoteCast. Once resolved, the proposal
// (AD2) and vote (AD4) rows pass the actor-resolution gate. Delegators land with AD5's delegation
// ingestion (no delegation archive rows exist yet).
export class SnapshotActorAddressDeriver implements OffchainActorAddressDeriver {
  readonly kind = 'offchain-actor-address' as const;
  readonly sourceTypes = ['snapshot'] as const;
  readonly eventTypes = ['SnapshotProposalCreated', 'SnapshotVoteCast'] as const;

  constructor(private readonly payloads: SnapshotArchivePayloadRepository) {}

  async fetchPayloads(
    rows: readonly OffchainArchiveRow[],
  ): Promise<readonly OffchainActorAddressPayloadRow[]> {
    const latest = await this.payloads.fetchLatest(rows);
    const eventTypeByExternalId = new Map(rows.map((row) => [row.external_id, row.event_type]));
    return latest.map((row) => {
      // fetchLatest only returns external_ids that were in `rows`, so the lookup cannot miss; a
      // miss is a real invariant violation — fail loud rather than mislabel or silently drop.
      const eventType = eventTypeByExternalId.get(row.external_id);
      if (eventType === undefined) {
        throw new Error(`snapshot actor sweep: no archive row for external_id ${row.external_id}`);
      }
      return { external_id: row.external_id, event_type: eventType, payload: row.payload };
    });
  }

  extractAddresses(eventType: ArchiveEventType, payload: string): readonly ActorAddressCandidate[] {
    if (eventType === 'SnapshotProposalCreated') {
      const proposer = (JSON.parse(payload) as SnapshotProposalPayload).author;
      if (proposer == null || proposer === '') return [];
      return [{ address: proposer, role: 'proposer_event' }];
    }
    if (eventType === 'SnapshotVoteCast') {
      const voter = (JSON.parse(payload) as SnapshotVotePayload).voter;
      if (voter == null || voter === '') return [];
      return [{ address: voter, role: 'voter_event' }];
    }
    return [];
  }
}
