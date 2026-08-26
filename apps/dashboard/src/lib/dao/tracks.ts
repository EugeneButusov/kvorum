// Governance-track registry (§6.6 §1, §6.17, DR-011). `dao_source.source_type` is an *ingestion*
// list: reconcilers, metadata enrichers, token indexers and execution contracts sit alongside the
// handful of types that are genuinely ways a DAO decides things (Aave has ten rows and three
// tracks). This module is the classifier that separates the two, so the UI can name governance
// tracks without reciting plumbing.
// See docs/superpowers/specs/2026-08-26-dao-overview-governance-tracks-design.md.

import { sourceLabel } from '@/lib/proposals/source';

export type GovernanceTrack = {
  sourceType: string;
  label: string;
  /** The track's electorate and semantics in one line; null for a type we don't recognise. */
  description: string | null;
};

/**
 * Recognised governance tracks. Key order is render order — binding on-chain votes first, then
 * superseded governors, then off-chain signalling.
 *
 * Labels deliberately omit the DAO name: these render under the DAO's own <h1>, unlike
 * `sourceLabel()`, which serves cross-DAO surfaces and must stay qualified.
 */
const TRACK_REGISTRY: Record<string, { label: string; description: string }> = {
  aragon_voting: {
    label: 'Aragon voting',
    description: 'Binding on-chain votes by LDO holders on the Aragon voting app.',
  },
  dual_governance: {
    label: 'Dual governance',
    description: 'stETH-holder veto power over the Aragon timelock.',
  },
  easy_track: {
    label: 'Easy Track',
    description: 'Optimistic motions for routine, pre-approved operations.',
  },
  aave_governance_v3: {
    label: 'Governance v3',
    description:
      'Binding on-chain votes by AAVE, stkAAVE and aAAVE holders, tallied on the cross-chain voting machine.',
  },
  aave_governor_v2: {
    label: 'Governor v2 (legacy)',
    description:
      'The pre-v3 on-chain governor, superseded by Governance v3. Retained for historical proposals.',
  },
  compound_governor_bravo: {
    label: 'Governor Bravo',
    description: 'Binding on-chain votes by COMP holders.',
  },
  compound_governor_alpha: {
    label: 'Governor Alpha (legacy)',
    description:
      'The original COMP governor, superseded by Governor Bravo. Retained for historical proposals.',
  },
  compound_governor_oz: {
    label: 'Governor (OZ)',
    description: 'OpenZeppelin Governor — binding on-chain token-holder votes.',
  },
  snapshot: {
    label: 'Snapshot',
    description: 'Off-chain signalling — token-weighted and non-binding.',
  },
};

/**
 * Suffixes that never name a governance track: reconcilers, metadata enrichers, and
 * token/delegation indexers. A structural rule rather than a list means a *new* source of these
 * kinds cannot leak into the UI without someone changing code.
 */
const INFRASTRUCTURE_SUFFIXES = ['_reconcile', '_metadata', '_meta', '_token'];

/** Indexed contracts that are a track's machinery rather than a track in their own right. */
const INFRASTRUCTURE_TYPES = new Set([
  // Where Governance v3 votes are physically cast. Same electorate as v3, so listing it separately
  // would assert two electorates where there is one — precisely what §6.17 exists to avoid.
  'aave_voting_machine',
  // Execution layer: runs a payload once a vote has passed, never holds one.
  'aave_payloads_controller',
  // Discussion, not a vote: no electorate, no voting-power semantics. The header links out to it.
  'discourse_forum',
]);

function isInfrastructure(sourceType: string): boolean {
  return (
    INFRASTRUCTURE_TYPES.has(sourceType) ||
    INFRASTRUCTURE_SUFFIXES.some((suffix) => sourceType.endsWith(suffix))
  );
}

/**
 * The user-facing governance tracks behind a DAO's `source_type` list: recognised tracks in
 * registry order, then unrecognised ones alphabetically. Unrecognised types are kept rather than
 * dropped so a newly indexed governance family surfaces the day it lands; they carry no description
 * because we have nothing honest to say about them yet.
 */
export function resolveTracks(sourceTypes: string[]): GovernanceTrack[] {
  const candidates = [...new Set(sourceTypes)].filter((s) => !isInfrastructure(s));

  const known: GovernanceTrack[] = [];
  for (const sourceType of Object.keys(TRACK_REGISTRY)) {
    if (!candidates.includes(sourceType)) continue;
    const entry = TRACK_REGISTRY[sourceType];
    if (!entry) continue;
    known.push({ sourceType, label: entry.label, description: entry.description });
  }

  const unknown: GovernanceTrack[] = candidates
    .filter((s) => !(s in TRACK_REGISTRY))
    .map((sourceType) => ({ sourceType, label: sourceLabel(sourceType), description: null }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [...known, ...unknown];
}
