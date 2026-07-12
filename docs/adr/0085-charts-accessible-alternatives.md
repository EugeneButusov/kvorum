# ADR-085 — Bespoke-SVG charts with a table alternative for every chart

- **Status**: Accepted
- **Date**: 2026-07-12
- **Spec sections affected**: 6.7, 6.11, 6.17, 6.19; 4.6.2
- **Related**: M6-1 design system (tokens), ADR-077 (Tailwind + tokens), DR-011 (Lido dual-track)

## Context

M6-4 builds the chart-heavy analytical pages — the DAO health dashboard (§6.7), the delegate
scorecard (§6.11), and the Lido dual-track landing (§6.17). They need time-series, stacked-area,
sparkline, heatmap, and delegation-flow visualisations bound to the live analytics endpoints.

Two constraints shape the foundation:

1. **The design system is specific and squared.** Tokens define an off-paper surface, 1px borders,
   a mono/tabular type scale, and a small three-colour data palette (`--for`/`--against`/`--abstain`,
   `--accent`/`--note`/`--warn`). A general charting library (Recharts, Chart.js, visx) renders to its
   own idiom — rounded, drop-shadowed, its own type and spacing — and fighting it back to the token
   aesthetic costs more than it saves. The M6 stack is deliberately dependency-light.

2. **SPEC §6.19 requires an accessible alternative for every chart.** "Charts include accessible
   alternatives: every chart has an associated table view accessible via a 'View as table'
   affordance." This is a hard commitment, not a nice-to-have.

## Decision

**Charts are bespoke inline SVG**, no charting library. A small set of primitives lives in
`apps/dashboard/src/components/charts/`, styled entirely through the design tokens (colours are
`var(--…)` in `fill`/`stroke` — no hex leaves `tokens.css`).

**Every chart is wrapped in `<Figure>`**, which owns the §6.19 contract: it titles the chart, carries
the legend, and renders a **"View as table" toggle** that swaps the SVG for a `<table>` built from the
same data. Each primitive supplies a `ChartTableModel` (columns + rows) derived from its own inputs,
so the accessible alternative is guaranteed **by construction** — a chart cannot ship without its
table. The SVG is exposed to assistive tech as a labelled `img`; the table is the real content.

Primitive set: `TimeSeries` (multi-series line), `StackedArea` (part-to-whole over time), `Sparkline`
(inline micro-trend), `Heatmap` (sequential magnitude grid), `DelegationFlow` (bipartite node-link).
Pure scale helpers (`linear`, `extent`, `bandCenters`) replace d3.

Charting rules the primitives follow (from the data-viz method, applied to the token palette):

- **One y-axis, never two.** Two measures of different scale become two charts.
- **Categorical hues in fixed order, never cycled** (`seriesColor`); a series past the palette folds
  to neutral ink, not a repeated hue. The green/amber/red order is the product convention; the CVD
  floor is covered by the mandated secondary encodings — a **legend for ≥2 series**, selective direct
  labels, and the table view — so identity is never colour-alone.
- **Sequential = one hue by opacity** (heatmap); **recessive axes/grid** (`--line-3`, `--ink-3`); all
  **text wears ink tokens**, never a series colour.
- The **"View as table" toggle is a keyboard-focusable button** with `aria-expanded`/`aria-controls`.

**Responsiveness (KNOWN-019).** These analytical pages are desktop-first; the minimum full-fidelity
viewport is 1280×720. Below that, charts degrade gracefully — SVGs scale to container width, wide
charts (heatmap, delegation-flow) scroll horizontally in their own overflow container, and the table
alternative is always available as the dense-data fallback.

## Consequences

- Charts read as one system with the rest of the dashboard, in both light and dark, with no library
  theme to override and no bundle cost.
- The accessible-alternative commitment is structural: `Figure` is the only way to mount a chart, and
  it requires the table model. Reviewers check one seam, not every chart.
- We own the charting code. The primitives are intentionally small; anything they can't express
  (dense interactive exploration) is out of v1 scope, consistent with the polling-not-streaming and
  desktop-first analytical posture.

## Alternatives considered

- **A charting library (Recharts/visx).** Faster to first chart, but the token-faithful squared/mono
  aesthetic and the §6.19 table contract both end up as wrappers around the library anyway, and the
  library's idiom keeps leaking through. Rejected for the aesthetic mismatch + dependency weight.
- **Table-only, no charts.** Meets §6.19 trivially but abandons §6.7's visual analytical value.
  Rejected — the table is the _alternative_, not the primary.
- **A separate accessibility layer bolted on later.** Rejected — deferring the table view invites
  charts that never get one. Building it into `Figure` up front makes the guarantee cheap.
