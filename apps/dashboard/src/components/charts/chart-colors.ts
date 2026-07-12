// Chart palette, drawn from the design tokens (ADR-085). Categorical hues are assigned in a fixed
// order and NEVER cycled — a series past the end folds to neutral ink rather than repainting an
// existing hue. The green/amber/red order is the product's three-colour convention; the CVD floor is
// covered by the mandated secondary encodings (direct labels + the "View as table" alternative).

export const CHART_SERIES = [
  'var(--accent)', // green
  'var(--note)', // amber
  'var(--against)', // red
  'var(--dao-arb)', // blue
  'var(--ink-2)', // near-ink
] as const;

/** Colour for the Nth series, in fixed order; folds to neutral past the palette (never cycles). */
export function seriesColor(index: number): string {
  return CHART_SERIES[index] ?? 'var(--ink-3)';
}

/** The vote three-colour, for tally-shaped charts. */
export const VOTE_COLORS = {
  for: 'var(--for)',
  against: 'var(--against)',
  abstain: 'var(--abstain)',
} as const;

/** Sequential single-hue ramp position (0..1) for heatmap magnitude, as an opacity over the accent. */
export function sequentialAlpha(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 0.12 + clamped * 0.88; // keep the lowest cells visible against the surface
}
