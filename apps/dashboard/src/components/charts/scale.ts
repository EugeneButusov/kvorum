// Tiny pure scale helpers for the bespoke-SVG charts — no d3, no chart lib (ADR-085).

/** A linear map from a data domain to a pixel range. */
export function linear(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1; // avoid divide-by-zero on a flat series
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Min/max of the values, optionally floored at zero (bar/area baselines). Flat series get a unit span. */
export function extent(values: number[], { includeZero = false } = {}): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) return [min, min + 1];
  return [min, max];
}

/** Evenly-spaced band centers across a range (categorical / time-bucket x positions). */
export function bandCenters(count: number, range: [number, number]): number[] {
  const [r0, r1] = range;
  if (count <= 0) return [];
  if (count === 1) return [(r0 + r1) / 2];
  const step = (r1 - r0) / count;
  return Array.from({ length: count }, (_, i) => r0 + step * (i + 0.5));
}
