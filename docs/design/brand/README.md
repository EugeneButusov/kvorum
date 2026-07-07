# Kvorum — brand assets

Concept: **C3 — Quorum bar**. A horizontal threshold bar where the filled
portion represents votes recorded, a vertical accent marks the quorum
threshold, and the K is carved from the filled area in negative space.
Squared off, geometric, no rounded corners — matches the V1 aesthetic.

## Files

| File                          | Use                                                                 |
|-------------------------------|---------------------------------------------------------------------|
| `Logo.tsx`                    | React component — `<Logo variant="glyph \| lockup \| wordmark" />`. |
| `Logo.module.css`             | Component styles. Uses design-system tokens; no hard-coded colors.  |
| `logo-glyph.svg`              | Themable — uses `currentColor` + CSS vars. **Use this in code.**    |
| `logo-glyph-mono.svg`         | Single-color version (ink + surface only). For greyscale contexts.  |
| `logo-glyph-light.svg`        | Hex-baked light theme. For external tools (Figma, GitHub READMEs).  |
| `logo-glyph-dark.svg`         | Hex-baked dark theme.                                                |
| `logo-lockup-light.svg`       | Glyph + KVORUM wordmark, light theme. Hex-baked.                    |
| `logo-lockup-dark.svg`        | Same, dark theme.                                                    |
| `wordmark-light.svg`          | Wordmark only (text rendered as `<text>`, requires JetBrains Mono). |
| `wordmark-dark.svg`           | Same, dark.                                                          |
| `favicon.svg`                 | 32×32 favicon, light-mode. Reacts to `prefers-color-scheme: dark`.  |

PNG renders (16/32/48/64/128/256 px) live in `png/` for places where SVG
isn't supported (some social previews, native installers).

## How to use in the app

Drop `Logo.tsx` and `Logo.module.css` into `components/Logo/` and import:

```tsx
import { Logo } from '@/components/Logo/Logo';

// in TopNav
<Logo variant="lockup" size={22} />
```

The glyph reads its colors from CSS:
- `color:` → bar fill + outline
- `--kv-accent` → threshold marker (defaults to `--accent`)
- `--kv-surface` → carved K (defaults to `--bg-2`)

When the logo sits on a non-default background, set `--kv-surface` on the
parent so the K punches through cleanly:

```css
.brand-on-card {
  --kv-surface: var(--bg-3);
}
```

## Color contract

| Token         | Light    | Dark     |
|---------------|----------|----------|
| `--ink`       | `#1a1a18`| `#f7f7f4`|
| `--bg-2`      | `#f7f7f4`| `#0e0e0c`|
| `--accent`    | `#00a86b`| `#00ff88`|

These are already defined in `design-system/tokens.css`. Do not hard-code
hex anywhere in the app — use the component.

## Construction grid

The mark is built on a 64×64 unit grid. Every stroke aligns to whole units:

- Bar track: 56×20, x=4, y=22
- Filled portion: 38 units wide (≈68% — past quorum)
- Threshold marker: 3 wide, y=10–54 (extends 12 units past the bar each side)
- K spine: 3 wide, x=15
- K arms: meet spine at the bar's vertical center (y=32)

Do not redraw at smaller sizes — the SVG scales cleanly to 16px.

## Don't

- Don't use the wordmark below 14px (the mono is illegible).
- Don't recolor the threshold marker to anything other than `--accent` /
  warning red (red is reserved for audit-flagged contexts).
- Don't add stroke or shadow to the glyph. It's flat by design.
- Don't place the lockup on a busy photographic background — find a flat
  surface or use the wordmark alone.
