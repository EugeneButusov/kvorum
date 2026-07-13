import { http, createConfig } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

// The chain SIWE identities are bound to. Kvorum authenticates against Ethereum mainnet only;
// the wallet may sit on another network, which drives the "wrong chain" state (design-decisions
// #391) — we never read on-chain state here, so a public RPC is sufficient for the injected flow.
export const AUTH_CHAIN = mainnet;

// Headless wagmi (no RainbowKit/Reown) — the connect UI is our own shadcn Dialog per ADR-077 /
// design-decisions #391. `injected()` covers browser-extension wallets (MetaMask, Rabby, …), the
// dominant path for Kvorum's Web3-native audience. `ssr: true` keeps hydration stable under the
// App Router.
export const wagmiConfig = createConfig({
  chains: [mainnet],
  connectors: [injected()],
  transports: { [mainnet.id]: http() },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
