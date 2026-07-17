import type { ProposalChoice, ProposalTallyRow } from '@libs/db';

// Assemble the proposal tally from the ClickHouse per-choice aggregate, overriding the summed power
// with the source's pre-computed `choice_scores` where the single primary_choice can't represent the
// tally (Snapshot approval/weighted/quadratic). Percentages are computed here — exactly, with BigInt
// on the UInt256 sums — so consumers render numbers instead of re-summing votes.

export type AssembledTallyChoice = {
  choice_index: number;
  /** UInt256 base units when `source` is `votes`; the raw score when `choice_scores`. */
  voting_power: string;
  voter_count: number;
  /** Share of participating power, 0–100, two decimals. */
  pct: number;
};

export type AssembledTally = {
  choices: AssembledTallyChoice[];
  total_voting_power: string;
  total_voters: number;
  source: 'votes' | 'choice_scores';
};

export type AssembleTallyArgs = {
  /** Declared choice indices (`proposal_choice`), so zero-power choices still surface. */
  declaredChoices: number[];
  /** ClickHouse GROUP BY primary_choice. */
  aggregate: ProposalTallyRow[];
  /** Snapshot approval/weighted per-choice scores (already human-scaled); null otherwise. */
  choiceScores: number[] | null;
};

/**
 * Pull a source's pre-computed per-choice scores out of its proposal metadata, if it carries any.
 * Source-blind: any metadata variant exposing a non-empty `choice_scores` array wins (Snapshot
 * approval/weighted today). Returns null so the caller falls back to the summed-votes tally.
 */
export function extractChoiceScores(metadata: unknown): number[] | null {
  if (
    metadata != null &&
    typeof metadata === 'object' &&
    'choice_scores' in metadata &&
    Array.isArray((metadata as { choice_scores?: unknown }).choice_scores)
  ) {
    const scores = (metadata as { choice_scores: number[] }).choice_scores;
    return scores.length > 0 ? scores : null;
  }
  return null;
}

export function assembleTally(args: AssembleTallyArgs): AssembledTally {
  const byChoice = new Map<number, { power: bigint; voters: number }>();
  for (const row of args.aggregate) {
    let power: bigint;
    try {
      power = BigInt(row.voting_power);
    } catch {
      power = 0n;
    }
    byChoice.set(row.primary_choice, { power: power < 0n ? 0n : power, voters: row.voter_count });
  }

  const totalVoters = [...byChoice.values()].reduce((sum, c) => sum + c.voters, 0);

  if (args.choiceScores && args.choiceScores.length > 0) {
    return assembleFromScores(args.choiceScores, byChoice, totalVoters);
  }
  return assembleFromVotes(args.declaredChoices, byChoice, totalVoters);
}

function assembleFromVotes(
  declaredChoices: number[],
  byChoice: Map<number, { power: bigint; voters: number }>,
  totalVoters: number,
): AssembledTally {
  const indices = sortedUnion(declaredChoices, [...byChoice.keys()]);
  const total = [...byChoice.values()].reduce((sum, c) => sum + c.power, 0n);

  const choices: AssembledTallyChoice[] = indices.map((index) => {
    const entry = byChoice.get(index);
    const power = entry?.power ?? 0n;
    return {
      choice_index: index,
      voting_power: power.toString(),
      voter_count: entry?.voters ?? 0,
      pct: bigintPct(power, total),
    };
  });

  return {
    choices,
    total_voting_power: total.toString(),
    total_voters: totalVoters,
    source: 'votes',
  };
}

function assembleFromScores(
  scores: number[],
  byChoice: Map<number, { power: bigint; voters: number }>,
  totalVoters: number,
): AssembledTally {
  const total = scores.reduce((sum, s) => sum + (s > 0 ? s : 0), 0);

  const choices: AssembledTallyChoice[] = scores.map((score, index) => ({
    choice_index: index,
    voting_power: String(score),
    voter_count: byChoice.get(index)?.voters ?? 0,
    pct: total > 0 ? Math.round((score / total) * 10000) / 100 : 0,
  }));

  return {
    choices,
    total_voting_power: String(total),
    total_voters: totalVoters,
    source: 'choice_scores',
  };
}

export type RowTallyChoice = { choice_index: number; label: string; pct: number };

/**
 * A compact per-choice tally for a proposals-list row: choice label + share of participating power.
 * Labels travel to the client so it classifies for/against/abstain in one place (the dashboard's
 * `classifyChoice`) rather than duplicating that regex server-side.
 *
 * Votes-summed only — unlike the detail tally it does not apply a source's `choice_scores` override,
 * so approval/weighted Snapshot proposals show their summed-primary-choice split here. That is exact
 * for the standard For/Against/Abstain governor votes that make up the tracked DAOs; the detail page
 * carries the authoritative tally. Returns null when no votes are cast (nothing to draw).
 */
export function assembleRowTally(args: {
  declaredChoices: ProposalChoice[];
  aggregate: ProposalTallyRow[];
}): RowTallyChoice[] | null {
  if (args.aggregate.length === 0) return null;

  const assembled = assembleTally({
    declaredChoices: args.declaredChoices.map((c) => c.choice_index),
    aggregate: args.aggregate,
    choiceScores: null,
  });

  const labelByIndex = new Map(args.declaredChoices.map((c) => [c.choice_index, c.value]));
  return assembled.choices.map((choice) => ({
    choice_index: choice.choice_index,
    label: labelByIndex.get(choice.choice_index) ?? `Choice ${choice.choice_index + 1}`,
    pct: choice.pct,
  }));
}

function bigintPct(part: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number((part * 10000n) / total) / 100;
}

function sortedUnion(a: number[], b: number[]): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}
