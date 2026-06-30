import type { JsonValue } from '@libs/domain';
import type { PollItem, PollListener, PollPollContext, PollResult } from '@sources/core';
import type { SnapshotClient } from '../client/client';
import type {
  SnapshotCursor,
  SnapshotProposalRow,
  SnapshotSubCursor,
  SnapshotVoteRow,
} from '../domain/types';
import { snapshotMetrics } from '../metrics';
import { contentHash } from './content-hash';

export const DEFAULT_PAGE_SIZE = 100;
// Snapshot's GraphQL caps `skip` at 5000 — page within a `created_gte` window up to the cap,
// then roll the window forward (the inclusive boundary re-checks the tail, consumer dedupes).
export const SKIP_CAP = 5000;

/** Returns the raw Snapshot proposal ids that should be re-queried for final tallies (closed,
 *  not-yet-final, within the recency window). Threads the per-tick signal into its PG read. */
export type SnapshotStaleProvider = (signal: AbortSignal) => Promise<string[]>;

export interface SnapshotPollListenerDeps {
  client: SnapshotClient;
  space: string;
  pageSize?: number;
  /** Optional closed-proposal reconcile pass (AD2). Omitted → forward-only polling. */
  staleProvider?: SnapshotStaleProvider;
}

function emptyCursor(): SnapshotCursor {
  return { proposals: { createdGte: 0, skip: 0 }, votes: { createdGte: 0, skip: 0 } };
}

/** Deletion sentinel for a stale proposal id the API no longer returns (a successful `id_in`
 *  query that omits it → deleted, not a transient gap). Re-archived, it flips content_hash and
 *  drives the projector to cancel the proposal. */
function deletionItem(id: string): PollItem {
  const payload = { id, deleted: true };
  return {
    externalId: `prop:${id}`,
    eventType: 'SnapshotProposalCreated',
    contentHash: contentHash(payload),
    ordinal: '0',
    payload,
  };
}

/** Advance one entity's sub-cursor: keep paging the same window while it yields full pages under
 *  the skip cap; otherwise roll `createdGte` to the newest row seen and reset `skip`. */
function advance(
  sub: SnapshotSubCursor,
  rows: ReadonlyArray<{ created: number }>,
  pageSize: number,
): SnapshotSubCursor {
  const fullPage = rows.length === pageSize;
  if (fullPage && sub.skip + pageSize < SKIP_CAP) {
    return { createdGte: sub.createdGte, skip: sub.skip + pageSize };
  }
  let maxCreated = sub.createdGte;
  for (const r of rows) {
    if (r.created > maxCreated) maxCreated = r.created;
  }
  return { createdGte: maxCreated, skip: 0 };
}

/** Closed-proposal reconcile pass: re-query stale proposals by id and emit them as normal proposal
 *  items (re-archive → mutable-latest re-derive captures the now-final tally). Absent ids from a
 *  successful query → deletion sentinels. Returns [] when no reconcile is configured. */
async function reconcile(deps: SnapshotPollListenerDeps, signal: AbortSignal): Promise<PollItem[]> {
  if (deps.staleProvider === undefined) return [];
  const ids = await deps.staleProvider(signal);
  if (ids.length === 0) return [];

  const fetched = await deps.client.fetchProposalsByIds(deps.space, ids, signal);
  snapshotMetrics.reconcileRequeried.add(fetched.length, { space_id: deps.space });

  const returned = new Set(fetched.map((row) => row.id));
  const items: PollItem[] = fetched.map(toProposalItem);
  for (const id of ids) {
    if (!returned.has(id)) items.push(deletionItem(id));
  }
  return items;
}

function toProposalItem(row: SnapshotProposalRow): PollItem {
  return {
    // Namespaced so proposals and votes never collide in archive_event_snapshot, which is keyed
    // on (dao_source_id, external_id). Derivers strip the prefix; raw id stays in payload.id.
    externalId: `prop:${row.id}`,
    eventType: 'SnapshotProposalCreated',
    contentHash: contentHash(row),
    ordinal: String(row.created),
    payload: row,
  };
}

function toVoteItem(row: SnapshotVoteRow): PollItem {
  return {
    externalId: `vote:${row.id}`,
    eventType: 'SnapshotVoteCast',
    contentHash: contentHash(row),
    ordinal: String(row.created),
    payload: row,
  };
}

function maxCreated(rows: ReadonlyArray<{ created: number }>): number {
  let max = 0;
  for (const r of rows) {
    if (r.created > max) max = r.created;
  }
  return max;
}

/** PollListener for one Snapshot space. Each tick pages proposals and votes forward independently
 *  and emits raw items; cursor persistence + enqueue are owned by the generic poll driver. Typed
 *  as PollListener<JsonValue> (the driver's type) — the SnapshotCursor shape is enforced via cast. */
export function makeSnapshotPollListener(
  deps: SnapshotPollListenerDeps,
  intervalMs: number,
): PollListener<JsonValue> {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const { client, space } = deps;

  return {
    intervalMs,
    async poll(ctx: PollPollContext, cursor: JsonValue | null): Promise<PollResult<JsonValue>> {
      const cur = (cursor as SnapshotCursor | null) ?? emptyCursor();

      const [proposals, votes] = await Promise.all([
        client.fetchProposals({
          space,
          createdGte: cur.proposals.createdGte,
          skip: cur.proposals.skip,
          first: pageSize,
          signal: ctx.signal,
        }),
        client.fetchVotes({
          space,
          createdGte: cur.votes.createdGte,
          skip: cur.votes.skip,
          first: pageSize,
          signal: ctx.signal,
        }),
      ]);

      snapshotMetrics.proposalsPolled.add(proposals.length, { space_id: space });
      snapshotMetrics.votesPolled.add(votes.length, { space_id: space });
      const newest = Math.max(maxCreated(proposals), maxCreated(votes));
      if (newest > 0) {
        snapshotMetrics.highWaterMarkLag.record(
          Math.max(0, Math.floor(Date.now() / 1000) - newest),
          {
            space_id: space,
          },
        );
      }

      const reconcileItems = await reconcile(deps, ctx.signal);

      const items: PollItem[] = [
        ...proposals.map(toProposalItem),
        ...votes.map(toVoteItem),
        ...reconcileItems,
      ];
      const nextCursor: SnapshotCursor = {
        proposals: advance(cur.proposals, proposals, pageSize),
        votes: advance(cur.votes, votes, pageSize),
      };

      return { items, nextCursor: nextCursor as unknown as JsonValue };
    },
  };
}
