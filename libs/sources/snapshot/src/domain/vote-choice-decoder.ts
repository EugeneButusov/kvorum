// Snapshot `vote.choice` → the unified choices breakdown (ADR-072 D3/D4). Indices are 0-based
// (Snapshot is 1-based); weights are decimal strings; `choices` is sorted desc by weight so
// `primaryChoice = choices[0].choice_index`. An unrecognised type or an unparseable choice (e.g. a
// shielded proposal's encrypted choice) returns `undecodable` → the applier marks it skipped.
//
// Encodings (verify against pinned live fixtures before the live backfill — copeland/quadratic are
// the least-certain):
//   single-choice/basic : int (1-based)                     e.g. 2
//   approval            : int[] (1-based)                    e.g. [1, 3]
//   weighted/quadratic  : { "<1-based>": <weight> }          e.g. { "1": 2, "2": 1 }
//   ranked-choice       : int[] in preference order          e.g. [3, 1, 2]
//   copeland            : int[] ranking (treated as ranked)  e.g. [2, 1, 3]

export interface DecodedChoice {
  choice_index: number;
  weight: string;
}

export type VoteChoiceDecode =
  | { kind: 'decoded'; primaryChoice: number; choices: DecodedChoice[] }
  | { kind: 'undecodable' };

// Full, unsplit weight for the single-vote-per-choice types (single-choice/basic/approval/ranked):
// each selected option carries weight "1.0" (the decimal-string contract, ADR-072 D3).
const WEIGHT_ONE = '1.0';
// Fixed-point base for normalizing weighted/quadratic raw weights into fractions without float drift
// (e.g. 1/3). 10^18 = 18 decimal places — far beyond display needs, and matches the wei/ether
// fixed-point convention used elsewhere in the codebase. The value is a precision choice, not
// semantically meaningful; any large power of ten would do. The rounding residue is given to the
// largest entry so the formatted weights sum to exactly "1.0".
const SCALE = 10n ** 18n;

export function decodeVoteChoice(
  votingType: string | null | undefined,
  choice: unknown,
  choiceCount: number,
): VoteChoiceDecode {
  try {
    switch (votingType) {
      case 'single-choice':
      case 'basic':
        return decodeSingle(choice, choiceCount);
      case 'approval':
        return decodeApproval(choice, choiceCount);
      case 'weighted':
      case 'quadratic':
        return decodeWeighted(choice, choiceCount);
      case 'ranked-choice':
      case 'copeland':
        return decodeRanked(choice, choiceCount);
      default:
        return { kind: 'undecodable' };
    }
  } catch {
    return { kind: 'undecodable' };
  }
}

function validIndex(oneBased: unknown, choiceCount: number): number | null {
  if (typeof oneBased !== 'number' || !Number.isInteger(oneBased)) return null;
  if (oneBased < 1 || oneBased > choiceCount) return null;
  return oneBased - 1;
}

function decodeSingle(choice: unknown, choiceCount: number): VoteChoiceDecode {
  const index = validIndex(choice, choiceCount);
  if (index === null) return { kind: 'undecodable' };
  return {
    kind: 'decoded',
    primaryChoice: index,
    choices: [{ choice_index: index, weight: WEIGHT_ONE }],
  };
}

function decodeApproval(choice: unknown, choiceCount: number): VoteChoiceDecode {
  if (!Array.isArray(choice) || choice.length === 0) return { kind: 'undecodable' };
  const indices: number[] = [];
  for (const raw of choice) {
    const index = validIndex(raw, choiceCount);
    if (index === null) return { kind: 'undecodable' };
    indices.push(index);
  }
  return {
    kind: 'decoded',
    primaryChoice: indices[0]!,
    choices: indices.map((choice_index) => ({ choice_index, weight: WEIGHT_ONE })),
  };
}

// Preference order is carried by the array order; choice_index is the option, weight "1.0" each.
function decodeRanked(choice: unknown, choiceCount: number): VoteChoiceDecode {
  return decodeApproval(choice, choiceCount);
}

function decodeWeighted(choice: unknown, choiceCount: number): VoteChoiceDecode {
  if (typeof choice !== 'object' || choice === null || Array.isArray(choice)) {
    return { kind: 'undecodable' };
  }
  const entries: { index: number; raw: bigint }[] = [];
  for (const [key, value] of Object.entries(choice as Record<string, unknown>)) {
    const index = validIndex(Number(key), choiceCount);
    if (index === null) return { kind: 'undecodable' };
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      return { kind: 'undecodable' };
    if (value === 0) continue; // a zero-weight option contributes nothing
    entries.push({ index, raw: BigInt(Math.round(value)) });
  }
  if (entries.length === 0) return { kind: 'undecodable' };

  const total = entries.reduce((sum, e) => sum + e.raw, 0n);
  if (total === 0n) return { kind: 'undecodable' };

  // Exact fractions in 1e18 fixed-point; the largest entry absorbs the rounding residue so the
  // weights sum to exactly "1.0".
  entries.sort((a, b) => (b.raw > a.raw ? 1 : b.raw < a.raw ? -1 : a.index - b.index));
  const scaled = entries.map((e) => (e.raw * SCALE) / total);
  const residue = SCALE - scaled.reduce((sum, s) => sum + s, 0n);
  scaled[0] = scaled[0]! + residue;

  const choices = entries.map((e, i) => ({
    choice_index: e.index,
    weight: formatScaled(scaled[i]!),
  }));
  return { kind: 'decoded', primaryChoice: choices[0]!.choice_index, choices };
}

function formatScaled(scaled: bigint): string {
  const intPart = scaled / SCALE;
  const fracPart = scaled % SCALE;
  if (fracPart === 0n) return `${intPart}.0`;
  const fracStr = fracPart.toString().padStart(18, '0').replace(/0+$/, '');
  return `${intPart}.${fracStr}`;
}
