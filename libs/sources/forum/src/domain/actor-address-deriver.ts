import type { OffchainArchiveRow } from '@libs/db';
import type {
  ActorAddressCandidate,
  OffchainActorAddressDeriver,
  OffchainActorAddressPayloadRow,
} from '@sources/core';

/**
 * Forum posts carry Discourse usernames, not on-chain addresses, so there are no actors to resolve.
 * This deriver exists ONLY to advance crawled-thread rows past the actor-resolution gate: the actor
 * sweep selects just the event types that have a registered `offchain-actor-address` deriver, and
 * derivation requires `derivation_actor_resolved_at` to be set. It returns one (empty) payload per
 * row so the sweep's key lookup matches, and extracts zero addresses — so the sweep marks the row
 * resolved without creating any actor, unblocking the thread projection.
 */
export class ForumThreadActorAddressDeriver implements OffchainActorAddressDeriver {
  readonly kind = 'offchain-actor-address' as const;
  readonly sourceTypes = ['discourse_forum'] as const;
  readonly eventTypes = ['DiscourseTopicCrawled'] as const;

  fetchPayloads(
    rows: readonly OffchainArchiveRow[],
  ): Promise<readonly OffchainActorAddressPayloadRow[]> {
    // No CH round-trip: the payload content is irrelevant (extractAddresses ignores it); only the
    // external_id key must match so the sweep pairs each row and marks it resolved.
    return Promise.resolve(
      rows.map((row) => ({
        external_id: row.external_id,
        event_type: row.event_type,
        payload: '',
      })),
    );
  }

  extractAddresses(): readonly ActorAddressCandidate[] {
    return [];
  }
}
