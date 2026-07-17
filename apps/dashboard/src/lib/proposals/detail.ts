// View-model + tally derivation for the proposal detail page (§6.9).
//
// Two boundary problems this module owns:
//   1. openapi-typescript renders the API's untyped-nullable fields (title, voting_*_at,
//      display_name, decoded_*, …) as `Record<string, never> | null` even though they are
//      `string | null` (or `unknown`) at runtime. We normalize them to honest types here so
//      the components downstream never wrestle the quirk.
//   2. There is no server-side tally aggregate. `voting_power_reported` is a UInt256 base-unit
//      string (exceeds Number.MAX_SAFE_INTEGER), so the tally is summed with BigInt and the
//      percentages — the scale-invariant, always-correct signal — are derived from those sums.

import type { components } from '@/lib/api/schema';

type RawDetail = components['schemas']['ProposalDetailDto'];
type RawAction = components['schemas']['ProposalActionDto'];
type RawVote = components['schemas']['VoteListItemDto'];
export type ProposalMetadata = NonNullable<RawDetail['metadata']>;

/** The runtime shape of an `@ApiProperty({ nullable: true })` field the generator typed as `{}`. */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// Governance tokens in scope (COMP, UNI, AAVE, LDO, ARB, …) are all 18-decimal, and the read API
// does not yet expose per-token decimals. Absolute power figures scale by this; percentages and
// voter counts do not depend on it. When the API surfaces decimals, replace this single constant.
const POWER_DECIMALS = 18n;

export type ChoiceView = { index: number; value: string };

export type ProposalActionView = {
  index: number;
  targetAddress: string;
  targetChainId: string;
  valueWei: string;
  functionSignature: string | null;
  decodedFunction: string | null;
  decodedArguments: unknown;
  calldata: string;
};

export type OffchainLinkView = {
  platform: string;
  host: string;
  url: string;
  title: string | null;
  confidence: 'high' | 'medium' | 'low';
  lastActivityAt: string | null;
};

export type ProposalDetailView = {
  daoSlug: string;
  sourceType: string;
  sourceId: string;
  title: string | null;
  state: string;
  binding: boolean;
  votingStartsAt: string | null;
  votingEndsAt: string | null;
  proposer: { address: string; displayName: string | null };
  description: string;
  originChainId: string;
  choices: ChoiceView[];
  actions: ProposalActionView[];
  payloads: RawDetail['payloads'];
  voting: RawDetail['voting'];
  metadata: ProposalMetadata | null;
  offchainLinks: OffchainLinkView[];
  lastUpdatedAt: string;
  confirmed: boolean;
};

export type VoteView = {
  voteId: string;
  votingChainId: string;
  voter: { address: string; displayName: string | null };
  votingPowerReported: string;
  votingPowerVerified: boolean;
  primaryChoice: number | null;
  castAt: string | null;
  reason: string | null;
};

export function normalizeProposalDetail(dto: RawDetail): ProposalDetailView {
  return {
    daoSlug: dto.dao_slug,
    sourceType: dto.source_type,
    sourceId: dto.source_id,
    title: asString(dto.title),
    state: dto.state,
    binding: dto.binding,
    votingStartsAt: asString(dto.voting_starts_at),
    votingEndsAt: asString(dto.voting_ends_at),
    proposer: {
      address: dto.proposer.address,
      displayName: asString(dto.proposer.display_name),
    },
    description: dto.description,
    originChainId: dto.origin_chain_id,
    choices: dto.choices.map((c) => ({ index: c.choice_index, value: c.value })),
    actions: dto.actions.map(normalizeAction),
    payloads: dto.payloads ?? null,
    voting: dto.voting ?? null,
    metadata: dto.metadata ?? null,
    offchainLinks: dto.offchain_discussion_links.map((l) => ({
      platform: l.platform,
      host: l.host,
      url: l.url,
      title: asString(l.title),
      confidence: l.confidence,
      lastActivityAt: asString(l.last_activity_at),
    })),
    lastUpdatedAt: dto._meta.last_updated_at,
    confirmed: dto._meta.confirmed,
  };
}

function normalizeAction(a: RawAction): ProposalActionView {
  return {
    index: a.action_index,
    targetAddress: a.target_address,
    targetChainId: a.target_chain_id,
    valueWei: a.value_wei,
    functionSignature: asString(a.function_signature),
    decodedFunction: asString(a.decoded_function),
    decodedArguments: a.decoded_arguments ?? null,
    calldata: a.calldata,
  };
}

export function normalizeVote(dto: RawVote): VoteView {
  return {
    voteId: dto.vote_id,
    votingChainId: dto.voting_chain_id,
    voter: { address: dto.voter.address, displayName: asString(dto.voter.display_name) },
    votingPowerReported: dto.voting_power_reported,
    votingPowerVerified: dto.voting_power_verified,
    primaryChoice: typeof dto.primary_choice === 'number' ? dto.primary_choice : null,
    castAt: asString(dto.cast_at),
    reason: asString(dto.reason),
  };
}

// —— Tally ————————————————————————————————————————————————————————————————————————
//
// The tally is aggregated server-side (GET .../tally) — exact per-choice power + percentages,
// one cheap request at any turnout. This layer only labels and display-scales it; no summing.

export type TallyKind = 'for' | 'against' | 'abstain';

/** The server tally aggregate (per-choice power + exact percentages). */
export type TallyData = components['schemas']['ProposalTallyDto'];

export type TallySegment = {
  choiceIndex: number;
  label: string;
  kind: TallyKind;
  /** Display-scaled power (token units). */
  power: number;
  /** 0–100, computed exactly server-side. */
  pct: number;
  voterCount: number;
};

export type PresentedTally = {
  segments: TallySegment[];
  totalPower: number;
  totalVoters: number;
  source: 'votes' | 'choice_scores';
  leading: TallySegment | null;
};

/** Classify a free-text choice label into the for/against/abstain colour treatment. */
export function classifyChoice(value: string): TallyKind {
  const v = value.trim().toLowerCase();
  if (/^(for|yes|yae|yea|aye|approve|in favou?r|支持)/.test(v)) return 'for';
  if (/^(against|no|nay|reject|oppose|反对)/.test(v)) return 'against';
  return 'abstain';
}

export type RowTallyBar = { kind: TallyKind; pct: number };

/**
 * Collapse a list-row's per-choice tally into up to three For/Against/Abstain bars (§6.5), summing
 * each choice's share into its classified bucket. Same `classifyChoice` the detail tally uses, so a
 * row and its detail page always agree on which colour a choice takes. Empty when there are no votes.
 */
export function presentRowTally(
  choices: readonly { label: string; pct: number }[] | null | undefined,
): RowTallyBar[] {
  if (!choices || choices.length === 0) return [];
  const byKind = new Map<TallyKind, number>();
  for (const choice of choices) {
    const kind = classifyChoice(choice.label);
    byKind.set(kind, (byKind.get(kind) ?? 0) + choice.pct);
  }
  const order: TallyKind[] = ['for', 'against', 'abstain'];
  return order
    .filter((kind) => byKind.has(kind))
    .map((kind) => ({ kind, pct: Math.round((byKind.get(kind) ?? 0) * 10) / 10 }));
}

function labelFor(choices: ChoiceView[], index: number): string {
  return choices.find((c) => c.index === index)?.value ?? `Choice ${index + 1}`;
}

/** Human-scaled power for a single reported (UInt256 base-unit) value; 0 on a non-integer string. */
export function scaleReportedPower(reported: string): number {
  try {
    const base = BigInt(reported);
    const whole = base / 10n ** POWER_DECIMALS;
    const frac = Number(base % 10n ** POWER_DECIMALS) / Number(10n ** POWER_DECIMALS);
    return Number(whole) + frac;
  } catch {
    return 0;
  }
}

// A tally power figure is UInt256 base units when summed from votes, or an already-human score
// for Snapshot approval/weighted — `source` disambiguates which scaling to apply for display.
function scaleTallyValue(value: string, source: TallyData['source']): number {
  return source === 'votes' ? scaleReportedPower(value) : Number(value) || 0;
}

/** Map the server tally aggregate onto render-ready segments, labelled from the proposal's choices. */
export function presentTally(data: TallyData, choices: ChoiceView[]): PresentedTally {
  const segments: TallySegment[] = data.choices.map((choice) => {
    const label = labelFor(choices, choice.choice_index);
    return {
      choiceIndex: choice.choice_index,
      label,
      kind: classifyChoice(label),
      power: scaleTallyValue(choice.voting_power, data.source),
      pct: choice.pct,
      voterCount: choice.voter_count,
    };
  });

  return {
    segments,
    totalPower: scaleTallyValue(data.total_voting_power, data.source),
    totalVoters: data.total_voters,
    source: data.source,
    leading: leadingOf(segments),
  };
}

function leadingOf(segments: TallySegment[]): TallySegment | null {
  if (segments.length === 0) return null;
  return segments.reduce((best, s) => (s.pct > best.pct ? s : best));
}
