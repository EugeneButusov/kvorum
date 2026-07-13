// Governance-track explanations for multi-source DAOs (§6.17, DR-011). Lido runs three-plus parallel
// tracks whose "voting power" means different things; the landing surfaces them explicitly and never
// collapses them into a unified figure.

const TRACK_INFO: Record<string, string> = {
  aragon_voting: 'Binding on-chain votes by LDO holders on the Aragon voting app.',
  snapshot: 'Off-chain signaling (lido-snapshot.eth), primarily but not exclusively LDO-weighted.',
  dual_governance: 'stETH-holder veto power over the Aragon timelock.',
  easy_track: 'Optimistic motions for routine, pre-approved operations.',
};

export function trackDescription(sourceType: string): string {
  return (
    TRACK_INFO[sourceType] ?? 'A distinct governance track with its own voting-power semantics.'
  );
}
