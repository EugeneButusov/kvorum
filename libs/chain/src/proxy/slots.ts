import type { ProxyKind } from './types.js';

/**
 * Canonical storage-slot constants probed in order by ProxyResolver.
 * Modern OZ TransparentUpgradeableProxy uses the EIP-1967 implementation slot (row 1).
 * Row 4 covers pre-1967 ZeppelinOS contracts only.
 */
export const STANDARD_PROXY_SLOTS: readonly { slot: string; kind: ProxyKind }[] = [
  // EIP-1967 implementation: keccak256("eip1967.proxy.implementation") - 1
  {
    slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
    kind: 'eip1967',
  },
  // EIP-1967 beacon: keccak256("eip1967.proxy.beacon") - 1
  {
    slot: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
    kind: 'eip1967-beacon',
  },
  // EIP-1822 (UUPS / Proxiable): keccak256("PROXIABLE") — no - 1, unlike the 1967 family
  {
    slot: '0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7',
    kind: 'eip1822',
  },
  // OZ legacy ZeppelinOS (pre-1967): keccak256("org.zeppelinos.proxy.implementation")
  {
    slot: '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',
    kind: 'oz-zeppelinos',
  },
];
