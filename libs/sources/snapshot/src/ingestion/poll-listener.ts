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

export interface SnapshotPollListenerDeps {
  client: SnapshotClient;
  space: string;
  pageSize?: number;
}

function emptyCursor(): SnapshotCursor {
  return { proposals: { createdGte: 0, skip: 0 }, votes: { createdGte: 0, skip: 0 } };
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

      const items: PollItem[] = [...proposals.map(toProposalItem), ...votes.map(toVoteItem)];
      const nextCursor: SnapshotCursor = {
        proposals: advance(cur.proposals, proposals, pageSize),
        votes: advance(cur.votes, votes, pageSize),
      };

      return { items, nextCursor: nextCursor as unknown as JsonValue };
    },
  };
}
