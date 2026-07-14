'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDisconnect } from 'wagmi';

import { fetchSession, logout, logoutEverywhere, type Session } from './client';
import { SESSION_QUERY_KEY } from './session-key';

export { SESSION_QUERY_KEY };

/**
 * The current dashboard session. `data === null` means signed out (a 401 is a normal state, not an
 * error), `undefined` while loading. Retry is off so a signed-out user resolves immediately.
 */
export function useSession() {
  return useQuery<Session | null>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    retry: false,
    staleTime: 60_000,
  });
}

/** Sign out of the current session (and disconnect the wallet locally), then refresh session state. */
export function useLogout() {
  const queryClient = useQueryClient();
  const { disconnect } = useDisconnect();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      disconnect();
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
      void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });
}

/** "Sign out everywhere" (§6.13) — destroys every session for the user. */
export function useLogoutEverywhere() {
  const queryClient = useQueryClient();
  const { disconnect } = useDisconnect();
  return useMutation({
    mutationFn: logoutEverywhere,
    onSuccess: () => {
      disconnect();
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
      void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });
}
