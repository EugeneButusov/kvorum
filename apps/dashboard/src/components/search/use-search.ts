'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { browserApi } from '@/lib/api/client';

export function useSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: async () => {
      const { data, error } = await browserApi.GET('/v1/search', {
        params: { query: { q: query } },
      });
      if (error) throw error;
      return data;
    },
    enabled: enabled && query.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
