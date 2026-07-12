import type { StatePillProps } from '@/components/ui/state-pill';

// Source states are free-form strings; fold them onto the six pill treatments. Unknown → draft.
const STATE_VARIANTS: Record<string, NonNullable<StatePillProps['state']>> = {
  active: 'active',
  open: 'active',
  pending: 'queued',
  queued: 'queued',
  scheduled: 'queued',
  succeeded: 'passed',
  passed: 'passed',
  approved: 'passed',
  enacted: 'executed',
  executed: 'executed',
  closed: 'executed',
  defeated: 'defeated',
  rejected: 'defeated',
  failed: 'defeated',
  objected: 'defeated',
  cancelled: 'defeated',
  canceled: 'defeated',
  expired: 'defeated',
  draft: 'draft',
};

export function stateToVariant(state: string): NonNullable<StatePillProps['state']> {
  return STATE_VARIANTS[state.toLowerCase()] ?? 'draft';
}

const DAO_VARIANTS = new Set(['compound', 'uniswap', 'aave', 'arb']);

/** Map a dao slug onto a Pill colour variant, or `none` when there's no brand colour. */
export function daoVariant(slug: string): 'none' | 'compound' | 'uniswap' | 'aave' | 'arb' {
  const s = slug.toLowerCase();
  if (s.startsWith('arbitrum')) return 'arb';
  return DAO_VARIANTS.has(s) ? (s as 'compound' | 'uniswap' | 'aave') : 'none';
}
