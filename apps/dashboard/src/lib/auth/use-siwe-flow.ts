'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useConnect, useSignMessage, useSwitchChain } from 'wagmi';

import { runSiweLogin } from './siwe';
import { SESSION_QUERY_KEY } from './use-session';
import { AUTH_CHAIN } from '@/lib/wallet/config';

// UI-facing flow states, mirroring design-decisions #391.
export type SiweStep =
  | 'disconnected'
  | 'connecting'
  | 'wrong-chain'
  | 'signing'
  | 'error'
  | 'success';

// The internal phase the flow drives itself through; `wrong-chain` is derived from live wallet
// state rather than stored, so it can't go stale when the user switches networks mid-flow.
type Phase = 'connect' | 'signing' | 'error' | 'success';

export function resolveStep(input: {
  phase: Phase;
  isConnected: boolean;
  isConnecting: boolean;
  isCorrectChain: boolean;
}): SiweStep {
  if (input.phase === 'error') return 'error';
  if (input.phase === 'success') return 'success';
  if (input.phase === 'signing') return 'signing';
  // phase === 'connect'
  if (input.isConnecting) return 'connecting';
  if (!input.isConnected) return 'disconnected';
  if (!input.isCorrectChain) return 'wrong-chain';
  // Connected on the right chain but not yet signing — the effect is about to kick off the sign.
  return 'signing';
}

/**
 * Drives the SIWE handshake for the connect Dialog. Exposes the derived `step` (design-decisions
 * #391), plus the imperative actions the dialog wires to buttons. Signing auto-starts once the
 * wallet is connected on the correct chain, so the user flow is: connect → (switch chain) → sign.
 */
export function useSiweFlow({
  email,
  onSuccess,
}: {
  email?: string;
  onSuccess?: () => void;
} = {}) {
  const queryClient = useQueryClient();
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();

  const [phase, setPhase] = useState<Phase>('connect');
  const [error, setError] = useState<string | null>(null);
  // Guards the auto-sign effect so a re-render can't fire a second handshake.
  const signingRef = useRef(false);

  const isCorrectChain = chainId === AUTH_CHAIN.id;
  const step = resolveStep({ phase, isConnected, isConnecting, isCorrectChain });

  const reset = useCallback(() => {
    signingRef.current = false;
    setError(null);
    setPhase('connect');
  }, []);

  const start = useCallback(() => {
    reset();
    // The injected connector configured in wagmiConfig; using the registered instance (rather than
    // a fresh injected()) keeps wagmi's connector state consistent.
    const connector = connectors[0];
    if (connector) connect({ connector });
  }, [connect, connectors, reset]);

  const runSign = useCallback(async () => {
    if (signingRef.current || address === undefined) return;
    signingRef.current = true;
    setError(null);
    setPhase('signing');
    try {
      await runSiweLogin({
        address,
        chainId: AUTH_CHAIN.id,
        email,
        sign: ({ message }) => signMessageAsync({ message }),
      });
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      setPhase('success');
      onSuccess?.();
    } catch (err) {
      signingRef.current = false;
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    }
  }, [address, email, onSuccess, queryClient, signMessageAsync]);

  // Auto-advance to signing once connected on the right chain. Only from the `connect` phase so it
  // never re-fires after an error (the user retries explicitly) or success.
  useEffect(() => {
    if (phase === 'connect' && isConnected && isCorrectChain && !signingRef.current) {
      void runSign();
    }
  }, [phase, isConnected, isCorrectChain, runSign]);

  const retry = useCallback(() => {
    signingRef.current = false;
    setError(null);
    if (!isConnected) {
      start();
    } else if (isCorrectChain) {
      setPhase('connect'); // re-arms the auto-sign effect
    } else {
      setPhase('connect');
    }
  }, [isConnected, isCorrectChain, start]);

  return {
    step,
    error,
    address,
    isSwitching,
    start,
    retry,
    reset,
    switchToAuthChain: () => switchChain({ chainId: AUTH_CHAIN.id }),
  };
}
