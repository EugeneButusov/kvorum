import type { SplitDelegationEvent } from './types';
import { SNAPSHOT_DELEGATION_SPACES } from '../../delegation/constants';

const TRACKED = new Set<string>(SNAPSHOT_DELEGATION_SPACES);

/** Split Delegation `context` is the Snapshot space, carried un-indexed in event data. We only
 *  ingest events for the seeded spaces — every event variant exposes `payload.context`. */
export function isTrackedSplitDelegation(event: SplitDelegationEvent): boolean {
  return TRACKED.has(event.payload.context);
}
