'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useDisconnect } from 'wagmi';

import { createKey, deleteAccount, fetchKeys, revokeKey, rotateKey, type ApiKey } from './keys';
import { SESSION_QUERY_KEY } from '@/lib/auth/use-session';

export const KEYS_QUERY_KEY = ['developer', 'keys'] as const;

/** The user's API keys. Retry off so a signed-out (401) state surfaces immediately. */
export function useKeys() {
  return useQuery<ApiKey[]>({
    queryKey: KEYS_QUERY_KEY,
    queryFn: fetchKeys,
    retry: false,
  });
}

export function useCreateKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (label?: string) => createKey(label),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY }),
  });
}

export function useRotateKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rotateKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY }),
  });
}

export function useRevokeKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY }),
  });
}

/** Permanent account deletion (§6.13). On success the session is gone — reset local state and leave. */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { disconnect } = useDisconnect();
  return useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      disconnect();
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
      queryClient.removeQueries({ queryKey: KEYS_QUERY_KEY });
      router.replace('/');
    },
  });
}
