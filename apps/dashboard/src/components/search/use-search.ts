'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { browserApi } from '@/lib/api/client';

type UseSearchOpts = { type?: 'proposal' | 'dao' | 'actor'; limit?: number };

export function useSearch(query: string, enabled: boolean, opts?: UseSearchOpts) {
  return useQuery({
    queryKey: ['search', query, opts?.type, opts?.limit],
    queryFn: async () => {
      const { data, error } = await browserApi.GET('/v1/search', {
        params: { query: { q: query, type: opts?.type, limit: opts?.limit } },
      });
      if (error) throw error;
      if (!data) throw new Error('No data returned');
      return data;
    },
    enabled: enabled && query.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
