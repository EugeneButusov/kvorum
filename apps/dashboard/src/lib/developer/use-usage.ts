'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchUsage, type UsageResponse } from './usage';

export const USAGE_QUERY_KEY = ['developer', 'usage'] as const;

export function useUsage() {
  return useQuery<UsageResponse>({
    queryKey: USAGE_QUERY_KEY,
    queryFn: fetchUsage,
    retry: false,
    refetchInterval: 15_000,
  });
}
