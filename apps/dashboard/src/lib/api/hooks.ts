'use client';

import { useQuery } from '@tanstack/react-query';

import { browserApi } from './client';
import { POLL_INTERVAL_MS } from './poll';

/**
 * Reference query hook demonstrating the full stack: the typed openapi-fetch client →
 * same-origin BFF → TanStack Query with §6.16 polling. Page epics follow this shape.
 * `dataUpdatedAt` from the returned query feeds the <Fresh> indicator.
 */
export function useDaos() {
  return useQuery({
    queryKey: ['daos'],
    queryFn: async () => {
      const { data, error } = await browserApi.GET('/v1/daos');
      if (error) throw error;
      return data;
    },
    refetchInterval: POLL_INTERVAL_MS.feed,
  });
}
