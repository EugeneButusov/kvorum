# Kvorum design system

Internal system for the Kvorum governance dashboard. This is the canonical source for type, color, spacing, and component patterns.

## Files

- **`tokens.css`** — CSS custom properties (variables) for color, type, space, motion, layout. Load this first. Light theme is default; dark theme via `[data-theme="dark"]` on `<html>`.
- **`components.css`** — Class-based component primitives. Each maps 1:1 to a React component (see `DESIGN-NOTES.md` for the mapping table; the shadcn target for each is in ADR-0077).
- **`components.html`** — Visual reference. **Open this in a browser to see every primitive rendered with its markup.**

## Design principles

### 1. Information density over breathing room

Kvorum users are auditors, delegates, and governance staff who read calldata, compare proposals, and chase mismatches. They want **more on screen**, not less. Defaults: 13px body, 1.5 line-height, dense tables. Whitespace is earned, not given.

### 2. Mono is for facts, sans is for prose

JetBrains Mono carries everything that should align or be copy-pasted: addresses, calldata, numbers, pills, captions, section labels. Inter carries human writing: descriptions, AI tl;dr, voter rationales. The mono/sans switch is itself a signal — when you see mono, treat it as data.

### 3. AI content is fenced, never blended

Every AI output sits inside an `<AIPanel>` with a 1.5px black border, a paper-yellow hatched background, and a black △ AI label. This is non-negotiable. Users must never wonder whether something was written by a person or generated. Inputs and the model name appear in the panel's footer.

### 4. Severity is exactly three colors

- **`--ok` / green** — quorum met, proposal passed, action verified.
- **`--note` / amber** — vote pending, undecided delegate, queued.
- **`--warn` / red** — mismatch, defeated, undisclosed action.

That's the entire severity vocabulary. No info-blue. No "soft warning" purple. If a state needs a fourth color, the state needs a redesign.

### 5. Borders, not shadows

Surfaces are differentiated by 1px borders, not elevation. Three border weights: `--line-3` (subtle), `--line-2` (default), `--line` (strong). The AI panel breaks the rule with 1.5px on purpose — that's how you know it's exceptional.

### 6. Squared off, not rounded

No `border-radius` on cards, buttons, inputs, banners. Avatars and the live-dot are the only round things in the app. This is a deliberate aesthetic choice — Kvorum is a tool, not a marketing site.

## Color rationale

| Token        | Hex (light) | Why |
|--------------|-------------|-----|
| `--bg`       | `#f7f7f4`   | Off-paper. Avoids the "fresh blank doc" feel of pure white; suggests a working surface. |
| `--ink`      | `#0e0e0c`   | Slightly green-warm black to harmonize with the terminal-green accent. |
| `--accent`   | `#00a86b`   | Terminal/Bloomberg green. Used sparingly: active nav underline, "live", "passed", primary CTA accents. |
| `--warn`     | `#c43a1f`   | Saturated red, clearly distinct from accent green. |
| `--note`     | `#d97706`   | Burnt amber — distinct from both green and red even for protan/deutan vision. |
| `--ai-bg`    | `#f3f1e8`   | Pale paper-yellow. Reads as "annotation" rather than "alert". |

Dark theme uses higher-saturation green (`#00ff88`) and red (`#ff5a3c`) because dim screens crush the muted variants. AI panel inverts to a dim olive-yellow (`#1a1c12`) — same family, much darker.

## Type rationale

We picked **Inter + JetBrains Mono** because:
- Inter has the variable-axis range and tabular numerics we need.
- JetBrains Mono has good 0/O distinction (critical for hex), tight `ss02` cv11 stylistic sets we use, and generous x-height that holds up at 10.5–11px.
- Both ship via `next/font`; both are SIL OFL-licensed.

We render **headings in mono**, not sans. This is unusual and deliberate — proposal numbers, section labels, and DAO names benefit from the alignment and "instrument-panel" feel mono provides. Sans is reserved for prose.

## When to extend the system

If you reach for a hex code or a font size that isn't in tokens — pause.

- **Almost always:** there's a token that fits. Re-read `tokens.css`.
- **Sometimes:** the token is missing. Add it to `tokens.css` (and dark theme), document its purpose with a comment, then use it.
- **Rarely:** you genuinely need a one-off (e.g. a chart-specific gradient). Keep it scoped to that page's CSS module and leave a `TODO(ds):` comment explaining why it stayed local.

## Versioning

This system is pre-1.0. Changes propagate via PR with screenshots of the components reference page (`components.html`). Once we ship to production, breaking changes go through a deprecation cycle.
