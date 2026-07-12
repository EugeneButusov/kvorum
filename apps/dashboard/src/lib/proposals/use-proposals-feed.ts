'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';

import { normalizeListItem, type ProposalListItemView } from './list';
import { browserApi } from '@/lib/api/client';
import { POLL_INTERVAL_MS } from '@/lib/api/poll';
import { parseQuota, quotaInterval, type QuotaState } from '@/lib/api/quota';

/** A cross-DAO proposals query (`/v1/proposals`) — the homepage feeds are narrow slices of it. */
export type FeedQuery = { state?: string; sort?: string; limit?: number };

type FeedResult = { items: ProposalListItemView[]; quota: QuotaState };

export type ProposalsFeed = {
  items: ProposalListItemView[];
  updatedAt: number;
  isError: boolean;
  isPaused: boolean;
};

/**
 * A homepage proposals feed (§6.4 / §6.16): polls `/v1/proposals` every 30s (backing off with quota,
 * ADR-035), sending `If-None-Match` so unchanged pages come back 304. SSR seeds the first result.
 * Both live sections (active proposals, activity feed) run one of these.
 */
export function useProposalsFeed(
  key: string,
  query: FeedQuery,
  initialItems: ProposalListItemView[],
): ProposalsFeed {
  const cache = useRef<{ etag: string | null; result: FeedResult }>({
    etag: null,
    result: { items: initialItems, quota: { fraction: null } },
  });

  const q = useQuery<FeedResult>({
    queryKey: ['proposals-feed', key],
    queryFn: async () => {
      const { data, response } = await browserApi.GET('/v1/proposals', {
        params: { query },
        ...(cache.current.etag ? { headers: { 'If-None-Match': cache.current.etag } } : {}),
      });
      if (response.status === 304) return cache.current.result; // unchanged — keep the prior page
      if (!data) throw new Error('feed unavailable');
      const result: FeedResult = {
        items: data.data.map(normalizeListItem),
        quota: parseQuota(response.headers),
      };
      cache.current = { etag: response.headers.get('etag'), result };
      return result;
    },
    initialData: { items: initialItems, quota: { fraction: null } },
    refetchInterval: (query) =>
      quotaInterval(POLL_INTERVAL_MS.feed, query.state.data?.quota.fraction ?? null),
  });

  const fraction = q.data?.quota.fraction ?? null;
  return {
    items: q.data?.items ?? initialItems,
    updatedAt: q.dataUpdatedAt,
    isError: q.isError,
    isPaused: fraction != null && fraction < 0.1,
  };
}
