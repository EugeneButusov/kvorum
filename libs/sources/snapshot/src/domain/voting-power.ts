// Snapshot `vp` is fractional reported voting power; the core `vote_events.voting_power` is an
// integer (UInt256). We store round(vp) there for the pipeline + approximate analytics, and keep the
// exact decimal `vp` in the Snapshot protocol table for display. No fixed-point scaling (that would
// corrupt the raw voting_power the API/analytics read directly). vp beyond 2^53 has already lost
// precision at the JSON-number source; round(vp) inherits that.
export function roundVp(vp: number | string | null | undefined): string {
  const n = typeof vp === 'string' ? Number(vp) : (vp ?? 0);
  if (!Number.isFinite(n) || n < 0) return '0';
  return BigInt(Math.round(n)).toString();
}

// Snapshot `network` is a decimal chain id ("1", "137"); `voting_chain_id` elsewhere is hex
// ("0x1"). Map for consistency; fall back to mainnet for a missing/invalid network.
export function networkToChainId(network: string | null | undefined): string {
  if (network == null || network === '') return '0x1';
  try {
    return `0x${BigInt(network).toString(16)}`;
  } catch {
    return '0x1';
  }
}
