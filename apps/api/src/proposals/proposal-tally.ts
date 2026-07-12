import type { ProposalTallyRow } from '@libs/db';

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

function bigintPct(part: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number((part * 10000n) / total) / 100;
}

function sortedUnion(a: number[], b: number[]): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}
