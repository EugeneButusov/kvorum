'use client';

import { WagmiProvider } from 'wagmi';

import { QueryProvider } from '@/components/query-provider';
import { wagmiConfig } from '@/lib/wallet/config';

/**
 * Wallet + data-layer providers. WagmiProvider wraps QueryProvider because wagmi's own hooks run
 * on the TanStack Query client, so the client must live below the wagmi context. Everything under
 * here is client-rendered; the server layout mounts this once around the app.
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryProvider>{children}</QueryProvider>
    </WagmiProvider>
  );
}
