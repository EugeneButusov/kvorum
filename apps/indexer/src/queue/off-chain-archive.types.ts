/** pg-boss payload for one off-chain item (ADR-071 §off-chain consumer, Z2).
 *  Carries the source-native identity + the raw payload; the consumer assigns the
 *  monotonic `version` from PG state at archive time (not in the job). */
import type { ArchiveEventType } from '@libs/domain';

export interface OffChainArchiveJob {
  daoSourceId: string;
  sourceType: string;
  externalId: string;
  eventType: ArchiveEventType;
  contentHash: string;
  ordinal: string | null;
  payload: unknown;
}
