import type { SnapshotProposalRow, SnapshotVoteRow } from '../domain/types';
import { snapshotMetrics } from '../metrics';
import { PROPOSALS_BY_IDS_QUERY, PROPOSALS_QUERY, VOTES_QUERY } from './queries';

export const DEFAULT_SNAPSHOT_GRAPHQL_URL = 'https://hub.snapshot.org/graphql';

export interface SnapshotClientOptions {
  /** Defaults to hub.snapshot.org/graphql. There is no production mirror hub — this is a single
   *  endpoint we retry/back off against, never fail over (ADR-071). */
  url?: string;
  /** Optional Snapshot API key (raises the rate limit; provision for the AG backfill). */
  apiKey?: string;
  /** Retry attempts on 5xx / network / 429 before giving up. Default 4. */
  maxRetries?: number;
  /** Base backoff in ms; doubles per attempt. Default 500. */
  backoffBaseMs?: number;
}

interface PageParams {
  space: string;
  createdGte: number;
  first: number;
  skip: number;
  signal: AbortSignal;
}

type Entity = 'proposal' | 'vote';

/** A permanent failure (GraphQL errors, a 4xx other than 429) — retrying won't help, so it
 *  surfaces immediately and fails the tick without burning the backoff budget. */
class NonRetriableSnapshotError extends Error {}

/** Sleep that rejects promptly if the per-tick deadline aborts mid-backoff. */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class SnapshotClient {
  private readonly url: string;
  private readonly apiKey: string | undefined;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;

  constructor(opts: SnapshotClientOptions = {}) {
    this.url = opts.url ?? DEFAULT_SNAPSHOT_GRAPHQL_URL;
    this.apiKey = opts.apiKey;
    this.maxRetries = opts.maxRetries ?? 4;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
  }

  async fetchProposals(p: PageParams): Promise<SnapshotProposalRow[]> {
    return this.request<SnapshotProposalRow>(
      PROPOSALS_QUERY,
      { space: p.space, createdGte: p.createdGte, first: p.first, skip: p.skip },
      'proposals',
      'proposal',
      p.signal,
    );
  }

  async fetchVotes(p: PageParams): Promise<SnapshotVoteRow[]> {
    return this.request<SnapshotVoteRow>(
      VOTES_QUERY,
      { space: p.space, createdGte: p.createdGte, first: p.first, skip: p.skip },
      'votes',
      'vote',
      p.signal,
    );
  }

  /** Reconcile re-query: fetch specific proposals by id for the closed-proposal final-tally sweep. */
  async fetchProposalsByIds(
    space: string,
    ids: readonly string[],
    signal: AbortSignal,
  ): Promise<SnapshotProposalRow[]> {
    if (ids.length === 0) return [];
    return this.request<SnapshotProposalRow>(
      PROPOSALS_BY_IDS_QUERY,
      { space, ids },
      'proposals',
      'proposal',
      signal,
    );
  }

  private async request<T>(
    query: string,
    variables: Record<string, unknown>,
    field: 'proposals' | 'votes',
    entity: Entity,
    signal: AbortSignal,
  ): Promise<T[]> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;

    let attempt = 0;
    for (;;) {
      const start = Date.now();
      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, variables }),
          signal,
        });
        snapshotMetrics.graphqlLatency.record(Date.now() - start, { entity });

        if (res.status === 429) {
          snapshotMetrics.rateLimited.add(1, { entity });
          await this.backoff(attempt, res.headers.get('retry-after'), signal, entity);
          attempt += 1;
          continue;
        }
        if (res.status >= 500) {
          await this.backoff(attempt, null, signal, entity);
          attempt += 1;
          continue;
        }
        if (!res.ok) {
          // 4xx (other than 429, handled above) is a client error — don't retry.
          throw new NonRetriableSnapshotError(`Snapshot GraphQL ${field} HTTP ${res.status}`);
        }

        const body = (await res.json()) as {
          data?: Record<string, T[] | undefined>;
          errors?: { message: string }[];
        };
        if (body.errors?.length) {
          throw new NonRetriableSnapshotError(
            `Snapshot GraphQL ${field} errors: ${body.errors[0]?.message ?? 'unknown'}`,
          );
        }
        return body.data?.[field] ?? [];
      } catch (err) {
        // Permanent failures and the per-tick deadline aborting are terminal — never retry.
        if (err instanceof NonRetriableSnapshotError) {
          snapshotMetrics.graphqlErrors.add(1, { entity });
          throw err;
        }
        if (signal.aborted) throw err;
        if (attempt >= this.maxRetries) {
          snapshotMetrics.graphqlErrors.add(1, { entity });
          throw err;
        }
        await abortableDelay(this.backoffMs(attempt), signal);
        attempt += 1;
      }
    }
  }

  /** Honour Retry-After (integer seconds) when present, else exponential backoff. Throws if the
   *  attempt budget is exhausted so the caller marks the tick failed (cursor not advanced). */
  private async backoff(
    attempt: number,
    retryAfter: string | null,
    signal: AbortSignal,
    entity: Entity,
  ): Promise<void> {
    if (attempt >= this.maxRetries) {
      snapshotMetrics.graphqlErrors.add(1, { entity });
      throw new Error(`Snapshot GraphQL ${entity} retry budget exhausted`);
    }
    const retryAfterMs = retryAfter != null ? Number(retryAfter) * 1000 : NaN;
    const waitMs = Number.isFinite(retryAfterMs) ? retryAfterMs : this.backoffMs(attempt);
    await abortableDelay(waitMs, signal);
  }

  private backoffMs(attempt: number): number {
    return this.backoffBaseMs * 2 ** attempt;
  }
}
