// Fixed-point base for normalizing raw uint256 ratios into decimal fractions without float drift
// (e.g. 1/3). 10^18 = 18 decimal places. Precision choice, not semantically meaningful; the
// rounding residue is given to the largest-ratio entry so the weights sum to exactly "1".
const SCALE = 10n ** 18n;

/**
 * Normalize raw Split Delegation ratios into fraction strings that sum to "1" (or "0" each when
 * the total is zero). Order is preserved to align with the delegate list.
 */
export function normalizeWeights(ratios: readonly bigint[]): string[] {
  const total = ratios.reduce((a, b) => a + b, 0n);
  if (total === 0n) return ratios.map(() => '0');

  const scaled = ratios.map((r) => (r * SCALE) / total);
  const residue = SCALE - scaled.reduce((a, b) => a + b, 0n);

  let maxIdx = 0;
  for (let i = 1; i < ratios.length; i++) {
    if ((ratios[i] as bigint) > (ratios[maxIdx] as bigint)) maxIdx = i;
  }
  scaled[maxIdx] = (scaled[maxIdx] as bigint) + residue;

  return scaled.map(formatScaled);
}

function formatScaled(v: bigint): string {
  const intPart = v / SCALE;
  const frac = v % SCALE;
  if (frac === 0n) return intPart.toString();
  const fracStr = frac.toString().padStart(18, '0').replace(/0+$/, '');
  return `${intPart.toString()}.${fracStr}`;
}
