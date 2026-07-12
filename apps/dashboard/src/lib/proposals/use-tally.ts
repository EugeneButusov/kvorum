'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';

import type { TallyData } from './detail';
import type { ProposalPath } from './votes';
import { browserApi } from '@/lib/api/client';
import { parseQuota, tallyIntervalMs, type QuotaState } from '@/lib/api/poll';

type TallyResult = { tally: TallyData; quota: QuotaState };

export type UseTallyResult = {
  tally: TallyData;
  /** Last successful poll (ms epoch), for the freshness indicator. */
  updatedAt: number;
  isError: boolean;
  /** Polling stopped because remaining quota fell below 10% (ADR-035). */
  isPaused: boolean;
  /** True while actively polling (proposal is live and quota allows it). */
  isLive: boolean;
};

/**
 * Live tally for a proposal (§6.16 / ADR-035). Polls the tally aggregate while the proposal is
 * `active`, sending `If-None-Match` so unchanged tallies come back 304 (cheap). The interval backs
 * off as remaining quota drops and pauses under 10%; the freshness indicator reflects the last
 * successful poll. SSR seeds the first value so there's no loading flash.
 */
export function useTally(
  path: ProposalPath,
  { active, initialTally }: { active: boolean; initialTally: TallyData },
): UseTallyResult {
  // Holds the last ETag + result so a 304 keeps the prior data instead of a spurious refetch.
  const cache = useRef<{ etag: string | null; result: TallyResult }>({
    etag: null,
    result: { tally: initialTally, quota: { fraction: null } },
  });

  const query = useQuery<TallyResult>({
    queryKey: ['proposal-tally', path.slug, path.source_type, path.source_id],
    queryFn: async () => {
      const { data, response } = await browserApi.GET(
        '/v1/daos/{slug}/proposals/{source_type}/{source_id}/tally',
        {
          params: { path },
          ...(cache.current.etag ? { headers: { 'If-None-Match': cache.current.etag } } : {}),
        },
      );
      if (response.status === 304) return cache.current.result; // unchanged — keep the prior tally
      if (!data) throw new Error('tally unavailable');
      const result: TallyResult = { tally: data.data, quota: parseQuota(response.headers) };
      cache.current = { etag: response.headers.get('etag'), result };
      return result;
    },
    initialData: { tally: initialTally, quota: { fraction: null } },
    refetchInterval: (q) =>
      active ? tallyIntervalMs(q.state.data?.quota.fraction ?? null) : false,
    refetchOnWindowFocus: active,
  });

  const fraction = query.data?.quota.fraction ?? null;
  const isPaused = active && fraction != null && fraction < 0.1;
  return {
    tally: query.data?.tally ?? initialTally,
    updatedAt: query.dataUpdatedAt,
    isError: query.isError,
    isPaused,
    isLive: active && !isPaused,
  };
}
