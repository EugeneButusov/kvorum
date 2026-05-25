import type { ConcentrationBucketRow } from './analytics-read-repository';
import type { ConcentrationRowDto } from './concentration.dto';
import { computeGini } from './gini';

function topShare(weights: bigint[], n: number, total: bigint): number {
  if (total === 0n) return 0;
  const top = [...weights].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0)).slice(0, n);
  const sum = top.reduce((acc, w) => acc + w, 0n);
  return Number(sum) / Number(total);
}

function effectiveDelegateCount(weights: bigint[]): number {
  const sum = weights.reduce((acc, w) => acc + w, 0n);
  if (sum === 0n) return 0;
  const sq = weights.reduce((acc, w) => acc + w * w, 0n);
  if (sq === 0n) return 0;
  return Number(sum * sum) / Number(sq);
}

export function toConcentrationRowDto(row: ConcentrationBucketRow): ConcentrationRowDto {
  const weights = row.weights.map((w) => BigInt(w));
  const total = BigInt(row.total_voting_power);
  return {
    bucket: row.bucket.toISOString(),
    gini: computeGini([...weights].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))),
    top_share: {
      n_1: topShare(weights, 1, total),
      n_5: topShare(weights, 5, total),
      n_10: topShare(weights, 10, total),
      n_20: topShare(weights, 20, total),
    },
    effective_delegate_count: effectiveDelegateCount(weights),
    total_voting_power: row.total_voting_power,
    delegate_count: row.delegate_count,
  };
}
