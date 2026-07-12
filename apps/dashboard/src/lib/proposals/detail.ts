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

export type TallyKind = 'for' | 'against' | 'abstain';

export type TallySegment = {
  choiceIndex: number;
  label: string;
  kind: TallyKind;
  /** Human-scaled power (token units), for display. */
  power: number;
  /** 0–100, derived from the exact BigInt sums. */
  pct: number;
};

export type Tally = {
  segments: TallySegment[];
  /** Human-scaled total participating power. */
  totalPower: number;
  /** Number of distinct votes counted; null when derived from a pre-aggregated source. */
  voterCount: number | null;
  /** Where the numbers came from — surfaced to the reader honestly. */
  source: 'choice_scores' | 'votes';
  /** True when the vote set was capped before it was exhausted (sum is a lower bound). */
  partial: boolean;
  leading: TallySegment | null;
};

/** Classify a free-text choice label into the for/against/abstain colour treatment. */
export function classifyChoice(value: string): TallyKind {
  const v = value.trim().toLowerCase();
  if (/^(for|yes|yae|yea|aye|approve|in favou?r|支持)/.test(v)) return 'for';
  if (/^(against|no|nay|reject|oppose|反对)/.test(v)) return 'against';
  return 'abstain';
}

function labelFor(choices: ChoiceView[], index: number): string {
  return choices.find((c) => c.index === index)?.value ?? `Choice ${index + 1}`;
}

/** Scale a UInt256 base-unit sum to a display number without losing magnitude. */
function scalePower(base: bigint): number {
  const whole = base / 10n ** POWER_DECIMALS;
  const frac = Number(base % 10n ** POWER_DECIMALS) / Number(10n ** POWER_DECIMALS);
  return Number(whole) + frac;
}

/** Human-scaled power for a single reported (UInt256 base-unit) value; 0 on a non-integer string. */
export function scaleReportedPower(reported: string): number {
  try {
    return scalePower(BigInt(reported));
  } catch {
    return 0;
  }
}

/** Percentage of `part` within `total`, to two decimals, from exact BigInt math. */
function pct(part: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return Number((part * 10000n) / total) / 100;
}

export type DeriveTallyOptions = { partial?: boolean };

/**
 * Derive the tally. Snapshot approval/weighted proposals carry a pre-summed `choice_scores`
 * (already human-scaled floats) — use it directly. Everything else sums `voting_power_reported`
 * (UInt256 base units) grouped by `primary_choice` across the votes.
 */
export function deriveTally(
  detail: Pick<ProposalDetailView, 'choices' | 'metadata'>,
  votes: readonly VoteView[],
  options: DeriveTallyOptions = {},
): Tally {
  const meta = detail.metadata;
  if (meta?.kind === 'snapshot' && meta.choice_scores && meta.choice_scores.length > 0) {
    return fromChoiceScores(detail.choices, meta.choice_scores, votes.length);
  }
  return fromVotes(detail.choices, votes, options.partial ?? false);
}

function fromChoiceScores(choices: ChoiceView[], scores: number[], voterCount: number): Tally {
  const total = scores.reduce((sum, s) => sum + (s > 0 ? s : 0), 0);
  const segments: TallySegment[] = scores.map((power, index) => {
    const label = labelFor(choices, index);
    return {
      choiceIndex: index,
      label,
      kind: classifyChoice(label),
      power,
      pct: total > 0 ? Math.round((power / total) * 10000) / 100 : 0,
    };
  });
  return {
    segments,
    totalPower: total,
    voterCount: voterCount > 0 ? voterCount : null,
    source: 'choice_scores',
    partial: false,
    leading: leadingOf(segments),
  };
}

function fromVotes(choices: ChoiceView[], votes: readonly VoteView[], partial: boolean): Tally {
  const sums = new Map<number, bigint>();
  for (const vote of votes) {
    if (vote.primaryChoice == null) continue;
    let power: bigint;
    try {
      power = BigInt(vote.votingPowerReported);
    } catch {
      continue; // non-integer power string — skip rather than poison the sum
    }
    if (power < 0n) continue;
    sums.set(vote.primaryChoice, (sums.get(vote.primaryChoice) ?? 0n) + power);
  }

  // Present every declared choice (even at zero power) plus any choice indices seen only in votes.
  const indices = new Set<number>([...choices.map((c) => c.index), ...sums.keys()]);
  const total = [...sums.values()].reduce((a, b) => a + b, 0n);

  const segments: TallySegment[] = [...indices]
    .sort((a, b) => a - b)
    .map((index) => {
      const base = sums.get(index) ?? 0n;
      const label = labelFor(choices, index);
      return {
        choiceIndex: index,
        label,
        kind: classifyChoice(label),
        power: scalePower(base),
        pct: pct(base, total),
      };
    });

  return {
    segments,
    totalPower: scalePower(total),
    voterCount: votes.length,
    source: 'votes',
    partial,
    leading: leadingOf(segments),
  };
}

function leadingOf(segments: TallySegment[]): TallySegment | null {
  if (segments.length === 0) return null;
  return segments.reduce((best, s) => (s.pct > best.pct ? s : best));
}
