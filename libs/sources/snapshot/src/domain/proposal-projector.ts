import { createHash } from 'node:crypto';
import type { ProposalState } from '@libs/db';
import { extractSnapshotTitle } from './title-extractor';
import type { SnapshotProposalPayload } from './types';

// Outcome of projecting one archived Snapshot proposal payload:
//  - 'flagged'  → spam; do not create a `proposal` row.
//  - 'deleted'  → the proposal vanished (reconcile sentinel); cancel an existing row.
//  - 'derive'   → upsert the proposal + metadata + choices.
export interface SnapshotProposalDerive {
  kind: 'derive';
  sourceId: string;
  proposerAddress: string | null;
  title: string | null;
  description: string;
  descriptionHash: string;
  votingStartsAt: Date | null;
  votingEndsAt: Date | null;
  state: ProposalState;
  stateUpdatedAt: Date;
  metadata: {
    space_id: string;
    voting_type: string | null;
    strategies: unknown;
    ipfs_hash: string | null;
    network: string | null;
    scores_state: string | null;
    flagged: boolean;
  };
  choices: string[];
}

export type SnapshotProposalProjection =
  | SnapshotProposalDerive
  | { kind: 'flagged'; sourceId: string }
  | { kind: 'deleted'; sourceId: string };

function toDate(unixSeconds: number | null | undefined): Date | null {
  return unixSeconds == null ? null : new Date(unixSeconds * 1000);
}

/** Snapshot lifecycle → unified `proposal_state` (ADR-030 note / plan §4.4). Snapshot is signaling
 *  and has no native pass/fail; the rule is deterministic from proposal-level scores. Binary
 *  For>Against interpretation is intentionally deferred (needs choice-label semantics). */
function mapState(payload: SnapshotProposalPayload): ProposalState {
  const state = payload.state;
  if (state === 'pending') return 'pending';
  if (state === 'active') return 'active';
  // closed (or anything else terminal on Snapshot's side)
  if (payload.scores_state !== 'final') return 'active'; // not yet finalized → reconcile will close it
  if ((payload.scores_total ?? 0) > 0) return 'succeeded';
  return 'expired';
}

export function projectSnapshotProposal(
  payload: SnapshotProposalPayload,
): SnapshotProposalProjection {
  const sourceId = payload.id;

  if (payload.deleted === true) return { kind: 'deleted', sourceId };
  if (payload.flagged === true) return { kind: 'flagged', sourceId };

  const description = payload.body ?? '';
  const choices = (payload.choices ?? []).map((choice) => String(choice));
  // `created` is always present; `end` exists once the proposal has a close time.
  const stateUpdatedAt = toDate(payload.end) ?? new Date(payload.created * 1000);

  return {
    kind: 'derive',
    sourceId,
    proposerAddress: payload.author != null ? payload.author.toLowerCase() : null,
    title: extractSnapshotTitle(payload.title) ?? `Snapshot proposal ${sourceId}`,
    description,
    descriptionHash: createHash('sha256').update(description).digest('hex'),
    votingStartsAt: toDate(payload.start),
    votingEndsAt: toDate(payload.end),
    state: mapState(payload),
    stateUpdatedAt,
    metadata: {
      space_id: payload.space?.id ?? '',
      voting_type: payload.type ?? null,
      strategies: payload.strategies ?? null,
      ipfs_hash: payload.ipfs ?? null,
      network: payload.network ?? null,
      scores_state: payload.scores_state ?? null,
      flagged: payload.flagged ?? false,
    },
    choices,
  };
}
