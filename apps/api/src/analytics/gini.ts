export function computeGini(sortedWeights: bigint[]): number {
  const n = sortedWeights.length;
  if (n <= 1) {
    return 0;
  }

  let sum = 0n;
  let weighted = 0n;

  for (let i = 0; i < n; i += 1) {
    const w = sortedWeights[i] ?? 0n;
    sum += w;
    weighted += BigInt(i + 1) * w;
  }

  if (sum === 0n) {
    return 0;
  }

  const numerator = 2n * weighted - BigInt(n + 1) * sum;
  const denominator = BigInt(n) * sum;
  return Number(numerator) / Number(denominator);
}
