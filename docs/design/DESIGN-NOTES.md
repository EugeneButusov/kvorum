# Kvorum — design notes & rationale

> **⚠️ Stack override — read first.** This file was authored by design as a standalone
> project `CLAUDE.md` that mandated **CSS Modules and forbade Tailwind / shadcn**. Kvorum's
> frozen SPEC (§10.9) builds the dashboard on **Tailwind + shadcn/ui**, and that is the
> decision of record — see **ADR-0077** (issue #388), which maps these design tokens onto a
> Tailwind theme and each primitive onto a shadcn component. Where the rules below conflict
> with Tailwind/shadcn (e.g. "Don't add Tailwind", "Don't add a UI library"), **ADR-0077 wins**.
> Everything else here — the token vocabulary, the six design principles, the hard visual
> rules (fenced AI output, three-colour severity, borders-not-shadows, squared-off, mono for
> facts) — remains the authoritative design intent and must survive the port. This file is
> reference, not agent instructions; it was deliberately renamed from `CLAUDE.md` so Claude
> Code does not read it as binding.

This file captures the design system's conventions and rationale for the Kvorum dashboard.

## What this project is

Kvorum is a multi-DAO governance dashboard. Surface area: cross-DAO proposal feed,
proposal detail with calldata + AI summary + mismatch flagging, voter tables,
delegate profiles, DAO health, forums, search, dev API.

Source spec: `docs/PRD.md`. Section numbers below (e.g. §6.9) refer to the PRD.

## Tech target

- **Framework:** Next.js (App Router), TypeScript.
- **Styling:** **CSS Modules** (`Component.module.css`) — not Tailwind, not styled-components.
- **Globals:** `app/globals.css` imports `design-system/tokens.css` once.
- **Fonts:** Inter (sans) + JetBrains Mono (mono), via `next/font`.
- **Icons:** None at the moment — we use unicode glyphs (◐ ⌘ ⌕ ↗ ↘ △ ✓ !) and shape primitives. Don't add an icon font without asking.

## The design system

Live, canonical source:
- `design-system/tokens.css` — color/type/space/motion/layout variables (CSS custom properties).
- `design-system/components.css` — class-based primitives that map 1:1 to React components.
- `design-system/components.html` — visual + code reference. Open this first.
- `design-system/README.md` — design rationale and decisions.

Every screen consumes these two CSS files. Page-specific styles live next to the page.

### Hard rules

1. **Never hard-code colors.** Always `var(--ink)`, `var(--bg-2)`, `var(--warn)` etc. If a needed shade is not in tokens, add it to tokens first.
2. **Spacing in multiples of 4** — use `var(--space-N)`. No `padding: 13px`.
3. **Mono for numbers, addresses, calldata, captions, pills.** Sans for prose and UI labels.
4. **No rounded corners** anywhere except: avatars, the live-dot, and `--r-pill` (used only when a true pill shape is needed). Kvorum is squared off.
5. **Borders are 1px** — `var(--line-3)` for subtle dividers, `var(--line-2)` for default borders, `var(--line)` for strong dividers (page-level underlines, top-nav). 1.5px is reserved for the AI panel.
6. **All AI output goes inside `<AIPanel>`.** Never render model output in raw `<p>` or generic `<Card>`. The hatch + black △ AI mark is a hard contract with users.
7. **Severity is exactly three colors:** `--ok` (green), `--note` (amber), `--warn` (red). No others. No info-blue, no purple-cool, etc.
8. **Tabular numerics required** on every number column (`font-variant-numeric: tabular-nums` or class `.tnum`).
9. **Light theme is default.** Dark theme is via `[data-theme="dark"]` on `<html>` and is fully supported. Test both.

### Component naming

Map class → component:

| CSS class       | React component   | Notes |
|-----------------|-------------------|-------|
| `.kv-topnav`    | `<TopNav>`        | Single instance per page, in app shell. |
| `.kv-crumb`     | `<Crumb>`         | Below `<TopNav>` on detail pages. |
| `.pill`         | `<Pill>`          | `kind` prop for `dao-*` tints. |
| `.state-pill`   | `<StatePill>`     | `state` prop: active / passed / executed / defeated / queued / draft. |
| `.vote-tag`     | `<VoteTag>`       | `choice` prop: for / against / abstain. |
| `.dot.live`     | `<LiveDot>`       | |
| `.ai-panel`     | `<AIPanel>`       | Children: `<AIPanel.Body>`, `<AIPanel.Foot>`. Always shows model + inputs. |
| `.kv-section`   | `<Section>`       | Numbered + uppercase mono header. |
| `.banner`       | `<Banner>`        | `severity` prop: warn / note / ok. |
| `.card`         | `<Card>`          | `flagged` prop ties to severity-warn. |
| `.field`        | `<FieldRow>`      | `k` and `v` props. Renders dashed bottom border. |
| `.seg`          | `<Segmented>`     | Controlled — `value` + `onChange` + `options`. |
| `.theme-toggle` | `<ThemeToggle>`   | Persists to `localStorage('kv:theme')`. |
| `.kv-footer`    | `<FreshFooter>`   | Sync time + build + deployment. |

### File layout (recommended)

```
app/
  globals.css              ← imports design-system/tokens.css + components.css
  layout.tsx               ← <TopNav>, <Crumb>, <main>, <FreshFooter>
  proposals/
    [id]/
      page.tsx             ← assembles ProposalHeader, AISummary, Mismatch, Tally, Voters, Forum, Similar
      page.module.css      ← page-specific layout (grid, sticky TOC)
  daos/
  delegates/
components/
  Pill/Pill.tsx + Pill.module.css
  StatePill/...
  AIPanel/...
  ...
design-system/
  tokens.css
  components.css
  components.html          ← visual reference, dev-only
```

### Working from HTML mocks

Hi-fi screens live at `hifi/v1-etherscan/*.html`. They are single-file HTML and are
the source of truth for layout + behavior. When porting:

1. Read the HTML top to bottom — every `<style>` block has section comments (`/* --- AI panel --- */`) that map directly to components.
2. Lift each section into a component. Move its CSS into `<Component>.module.css`.
3. Replace inline color hex with `var(--…)` tokens. If anything resists tokenization, surface it — that's a hole in tokens, not a license to hard-code.
4. Keep section comments intact in CSS Modules; future me will thank you.

### What to ask before adding new patterns

- Is this already in `design-system/components.css`? Use it.
- Is there a near-miss that should be extended? Extend it, document why.
- Genuinely new? Add it to `components.css` AND `components.html` AND this table.

Don't introduce one-off styles in page CSS modules without leaving a `TODO(ds):` note saying it should be promoted.

## Data layer (current placeholder)

- All data in mocks is fixture. Real source TBD: subgraph, governance APIs, custom indexer.
- Server components fetch + cache; client components only for interactivity (sort, filter, theme toggle).
- Money / power values: format with `Intl.NumberFormat`. Always show units (`COMP`, `UNI`, `votes`). Always tabular.

## Accessibility

- Color contrast: severity colors meet 4.5:1 against their `-bg` background — keep that.
- All interactive elements must have a keyboard focus ring. Don't suppress with `outline: none` without supplying `:focus-visible` styles.
- Status changes (live dot pulse, vote ending soon) — wrap with `aria-live="polite"` and supply text equivalents.
- The AI panel's △ AI mark is decorative; the `<AIPanel>` component must have an `aria-label="AI generated content"` on its outer container.

## Don't

- Don't add Tailwind. Don't add styled-components. Don't add CSS-in-JS runtimes.
- Don't add a UI library (shadcn/ui, Radix, MUI). We're hand-building primitives.
- Don't import design files from elsewhere — system is internal.
- Don't render emoji as content. Unicode glyphs ok.
- Don't add gradients beyond the AI panel hatch and the description fade.
- Don't add elevation/shadow. Borders only.
