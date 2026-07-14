# ADR-077 — Design system on Tailwind + shadcn/ui: token and component mapping

- **Status**: Accepted
- **Date**: 2026-07-08
- **Spec sections affected**: 6.2, 6.3, 6.19, 10.8, 10.9
- **Related**: design bundle import (`docs/design/`, #385), brand kit (#386), `docs/design/DESIGN-NOTES.md`

## Context

M5.5 delivered a complete design package (imported under `docs/design/`): a CSS
design system (`design-system/tokens.css` + `components.css` + `components.html`),
hi-fi HTML mocks for every page type, wireframes, and a brand kit. The package was
authored as **hand-built CSS-Module primitives** and its original conventions file
(now `DESIGN-NOTES.md`) explicitly forbade Tailwind and any UI library.

The frozen spec goes the other way: **§10.9 (M6) builds the dashboard on Tailwind
and shadcn/ui**, and §10.8 requires a documented shadcn component mapping. The two
must be reconciled before M6 starts, because the choice defines the entire
component layer. The decision of record is to **keep Tailwind + shadcn/ui** (spec
§10.9); the delivered HTML mocks become the layout + interaction reference that M6
re-expresses in Tailwind/shadcn, not a CSS-Modules codebase to port verbatim.

This ADR is the translation contract: how `tokens.css` becomes a Tailwind theme,
how our tokens coexist with shadcn's expected CSS variables, which shadcn component
backs each design primitive, and where shadcn defaults must be overridden to honour
the design's hard rules. It is a **specification for M6** — no `apps/dashboard`
config is changed here; M6 implements against it.

## Decision

### 1. Tokens stay canonical; Tailwind and shadcn consume them

`docs/design/tokens.css` (the CSS custom properties, light default + a
`[data-theme="dark"]` block) is copied into `apps/dashboard` and imported once in
`app/global.css`. It remains the **single source of truth** for colour, type,
space, and motion. Neither Tailwind config nor shadcn redefines a colour — both
reference `var(--token)`. This preserves the design's light/dark contract and its
rule that no hex is ever hard-coded outside `tokens.css`.

Tailwind `theme.extend.colors` exposes the tokens as utilities by referencing the
variables directly (hex-valued, **not** the `hsl(var(--x) / <alpha-value>)` wrapper
shadcn ships by default — see §5):

```js
// tailwind.config.js  (theme.extend) — proposed; implemented in M6
colors: {
  bg:   { DEFAULT: 'var(--bg)', 2: 'var(--bg-2)', 3: 'var(--bg-3)' },
  ink:  { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', 3: 'var(--ink-3)', 4: 'var(--ink-4)' },
  line: { DEFAULT: 'var(--line)', 2: 'var(--line-2)', 3: 'var(--line-3)' },
  accent: { DEFAULT: 'var(--accent)', bg: 'var(--accent-bg)', ink: 'var(--accent-ink)' },
  warn: { DEFAULT: 'var(--warn)', bg: 'var(--warn-bg)', ink: 'var(--warn-ink)' },
  note: { DEFAULT: 'var(--note)', bg: 'var(--note-bg)', ink: 'var(--note-ink)' },
  ok:   'var(--ok)',
  ai:   { bg: 'var(--ai-bg)', line: 'var(--ai-line)', mark: 'var(--ai-mark)' },
  vote: { for: 'var(--for)', against: 'var(--against)', abstain: 'var(--abstain)' },
  dao:  { compound: 'var(--dao-compound)', uniswap: 'var(--dao-uniswap)', aave: 'var(--dao-aave)',
          arb: 'var(--dao-arb)', op: 'var(--dao-op)', ens: 'var(--dao-ens)',
          lido: 'var(--dao-lido)', mkr: 'var(--dao-mkr)' },
},
```

Spacing needs no mapping: the token scale is 4px-based, identical to Tailwind's
default (`p-1` = 4px, `p-2` = 8px …). `fontFamily` maps `sans → var(--font-sans)`,
`mono → var(--font-mono)` (Inter + JetBrains Mono via `next/font`). The `--fs-*`
type scale and `--lh-*`/`--tracking-*` tokens are added as named `fontSize`
entries (e.g. `text-body` = 13px, `text-caption` = 10.5px mono, `text-h1` = 30px).

### 2. shadcn semantic variables alias onto Kvorum tokens

shadcn components reference their own variable names (`--background`,
`--foreground`, `--primary`, `--border`, `--ring`, …). Rather than fork every
component, we add a thin **alias layer** in `global.css` (inside `:root` and the
`[data-theme="dark"]` block) that points shadcn's names at our tokens:

| shadcn variable            | → Kvorum token    | Notes                                                                                                                                           |
| -------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `--background`             | `--bg`            | page surface                                                                                                                                    |
| `--foreground`             | `--ink`           | primary text                                                                                                                                    |
| `--card` / `--popover`     | `--bg-2`          | card / raised surface (no shadow — see §4)                                                                                                      |
| `--card-foreground`        | `--ink`           |                                                                                                                                                 |
| `--primary`                | `--accent`        | **brand green** — solid CTAs, active states                                                                                                     |
| `--primary-foreground`     | `#f7f7f4` (paper) | text/glyph on solid green; **not** `--accent-ink` (that is for tints)                                                                           |
| `--secondary` / `--muted`  | `--bg-3`          | sunken / track surfaces                                                                                                                         |
| `--secondary-foreground`   | `--ink`           |                                                                                                                                                 |
| `--muted-foreground`       | `--ink-3`         | captions, tertiary                                                                                                                              |
| `--accent` _(shadcn)_      | `--bg-3`          | ⚠ **name collision** — shadcn `--accent` is a hover surface, not the brand accent. It maps to a muted surface; the brand green is `--primary`. |
| `--accent-foreground`      | `--ink`           |                                                                                                                                                 |
| `--destructive`            | `--warn`          | the only severity shadcn ships (see §3)                                                                                                         |
| `--destructive-foreground` | `#f7f7f4` (paper) |                                                                                                                                                 |
| `--border` / `--input`     | `--line-2`        | default 1px border                                                                                                                              |
| `--ring`                   | `--accent`        | focus ring is brand green (a11y §6)                                                                                                             |
| `--radius`                 | `0`               | squared-off (see §4)                                                                                                                            |

The one trap for implementers is the **`--accent` collision**: in shadcn's
vocabulary `--accent` means "subtle hover/active background", whereas Kvorum's
`--accent` is the terminal-green brand colour. In the alias layer, shadcn
`--accent` → `--bg-3` and the brand green is reached through `--primary` (or the
`accent` Tailwind colour from §1). Component code should prefer the Kvorum
utilities (`bg-accent`, `text-warn`) for design-specific styling and let the
shadcn aliases serve only the stock shadcn internals.

### 3. Severity is three colours, added as cva variants

shadcn ships only `default` + `destructive`. Kvorum's severity vocabulary is
exactly **three** (`--ok` green, `--note` amber, `--warn` red) and no others (no
info-blue). Where a shadcn primitive expresses severity (Badge, Alert), M6 extends
it with a `severity` variant via `class-variance-authority` bound to the
`{ok,note,warn}` + `{ok,note,warn}-bg`/`-ink` tokens — never by adding a fourth
colour. The `default`/`secondary`/`outline` variants stay for non-severity uses.

### 4. Hard-rule overrides on stock shadcn

shadcn's defaults conflict with four of the design's non-negotiable rules
(`DESIGN-NOTES.md`). Each is overridden globally, once, not per-component:

- **Squared-off.** `--radius: 0`. Tailwind `borderRadius` keeps only `none: 0`,
  `sm: 2px` (`--r-sm`), and `full: 9999px` (`--r-pill`). Rounded corners are
  allowed **only** on avatars, the live-dot, and true pills. Strip `rounded-*`
  from shadcn component sources on adoption.
- **Borders, not shadows.** The design has no elevation. Do not use `shadow-*`
  utilities; surfaces are separated by 1px borders (`--line-3` subtle, `--line-2`
  default, `--line` strong). Remove shadcn's default `shadow-sm`/`shadow-md` from
  Card, Popover, Dropdown, Dialog on adoption; use `border` instead.
- **Mono for facts.** Numbers, addresses, calldata, pills, captions, and section
  labels render in JetBrains Mono; headings render in mono too (deliberate). Sans
  (Inter) is prose only. Tabular numerics (`font-variant-numeric: tabular-nums`,
  utility `tabular-nums`) are required on every number column.
- **Three-colour severity** — see §3.

### 5. Colours are referenced directly, not via the alpha-value wrapper

shadcn's default Tailwind config wraps every colour as
`hsl(var(--token) / <alpha-value>)`, which requires the CSS variables to hold bare
HSL channels. Our tokens are hex. We therefore reference them **directly**
(`var(--bg)`), and accept that Tailwind opacity modifiers (`bg-primary/50`) do not
apply to token colours. This is acceptable: the design is built on solid fills and
1px borders with no translucency or elevation. If a specific token later needs
opacity modifiers, it is migrated to an HSL/`<alpha-value>` triplet in isolation —
not the whole palette.

### 6. Theme switching and focus

- Dark mode uses the **`[data-theme="dark"]` attribute** the tokens already key
  off — not shadcn's `.dark` class. Tailwind: `darkMode: ['selector', '[data-theme="dark"]']`;
  runtime via `next-themes` with `attribute="data-theme"`. Light theme is default.
- Every interactive element keeps a visible `:focus-visible` ring (`--ring` =
  `--accent`); do not suppress `outline` without supplying one (a11y, spec §6.19).

### 7. Component inventory (design primitive → shadcn)

"shadcn" = adopt the shadcn component, restyled per §4. "bespoke" = hand-built
(no suitable shadcn primitive); it still consumes tokens and Tailwind utilities.

| Design primitive (`DESIGN-NOTES` / §6.3) | React            | shadcn backing                     | Customization                                                                                                                                             |
| ---------------------------------------- | ---------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button                                   | `<Button>`       | **Button**                         | radius→0, drop shadow; variants: default=`--accent`, destructive=`--warn`, outline, ghost, link                                                           |
| Input / Select / Textarea                | —                | **Input / Select / Textarea**      | squared, `--line-2` border, `--accent` focus ring                                                                                                         |
| Tooltip                                  | —                | **Tooltip** (Radix)                | squared, `--ink` surface, mono caption                                                                                                                    |
| `.pill`                                  | `<Pill>`         | **Badge**                          | `kind` → `dao-*` swatch border/dot; mono, squared                                                                                                         |
| `.state-pill`                            | `<StatePill>`    | **Badge** + cva                    | `state`: active/passed/executed/defeated/queued/draft → severity tokens                                                                                   |
| `.vote-tag`                              | `<VoteTag>`      | **Badge** + cva                    | `choice`: for/against/abstain → `--for`/`--against`/`--abstain`                                                                                           |
| `.banner`                                | `<Banner>`       | **Alert** + cva                    | `severity` warn/note/ok (§3); squared, no info-blue                                                                                                       |
| `.card`                                  | `<Card>`         | **Card**                           | drop shadow, radius→0; `flagged` prop → `--warn` border + `--warn-bg`                                                                                     |
| `.seg`                                   | `<Segmented>`    | **ToggleGroup** (`type=single`)    | controlled; squared segments, `--accent` active                                                                                                           |
| `.kv-crumb`                              | `<Crumb>`        | **Breadcrumb**                     | mono, squared, `↗`/`→` glyph separators                                                                                                                  |
| Voter / holder tables                    | —                | **Table**                          | dense, `tabular-nums`, `--line-3` row dividers                                                                                                            |
| Page tabs                                | —                | **Tabs**                           | squared, `--line` underline on active                                                                                                                     |
| Filter / account menus                   | —                | **DropdownMenu**                   | squared, border not shadow                                                                                                                                |
| Wallet / confirm modals; mobile nav      | —                | **Dialog / Sheet**                 | squared, border; feeds §6.14 auth + mobile chrome (#390, #391)                                                                                            |
| Loading states                           | —                | **Skeleton**                       | squared; part of empty/loading/error set (§6.3, #392)                                                                                                     |
| Avatars, delegate identity chip          | `<IdentityChip>` | **Avatar** + bespoke               | avatar is one of the few rounded elements; chip = avatar + address + name                                                                                 |
| `.ai-panel`                              | `<AIPanel>`      | **bespoke**                        | 1.5px `--ai-line` border, hatched `--ai-bg`, black △ mark, model+inputs footer; `aria-label="AI generated content"`. Hard contract — no shadcn equivalent |
| Mismatch indicator                       | `<Mismatch>`     | **bespoke** (Alert-adjacent)       | `--warn` severity; the audit-flag surface                                                                                                                 |
| Voting-power figure                      | `<Power>`        | **bespoke**                        | mono tabular number + unit (`COMP`/`UNI`/`votes`), `Intl.NumberFormat`                                                                                    |
| Time freshness indicator                 | `<Fresh>`        | **bespoke**                        | relative time + `aria-live="polite"`; pairs with LiveDot                                                                                                  |
| `.dot.live`                              | `<LiveDot>`      | **bespoke**                        | rounded-full; pulse wrapped for reduced-motion                                                                                                            |
| `.kv-section`                            | `<Section>`      | **bespoke**                        | numbered uppercase mono header + rule                                                                                                                     |
| `.field`                                 | `<FieldRow>`     | **bespoke**                        | key/value row, dashed `--line-3` bottom border                                                                                                            |
| `.kv-topnav`                             | `<TopNav>`       | **bespoke** (+ NavigationMenu opt) | app-shell nav; `--line` underline; theme toggle slot                                                                                                      |
| `.kv-footer`                             | `<FreshFooter>`  | **bespoke**                        | sync time + build + deployment                                                                                                                            |
| `.theme-toggle`                          | `<ThemeToggle>`  | **bespoke** (Button base)          | `next-themes`; persists to `localStorage('kv:theme')`                                                                                                     |
| Empty / error states                     | —                | **bespoke**                        | squared, severity-aware; built from spec (§6.3)                                                                                                           |
| Notifications (toast)                    | —                | **Sonner** _(if in scope)_         | deferred — see #394                                                                                                                                       |

## Alternatives considered

- **Ratify the delivered CSS-Modules system (drop Tailwind/shadcn).** Rejected:
  contradicts frozen spec §10.9, forgoes shadcn's accessible Radix primitives
  (Dialog/Tooltip/DropdownMenu focus management), and the operator explicitly
  chose to keep Tailwind + shadcn. The CSS system is preserved as the visual
  reference, not the runtime.
- **Adopt shadcn's variables as canonical and rewrite the tokens as HSL triplets.**
  Rejected: it would fork the design's `tokens.css` (breaking parity with the hi-fi
  mocks and the brand kit's hex contract) purely to gain opacity modifiers the flat
  design does not use. The alias layer (§2) gets shadcn working with zero token
  churn.
- **Skip shadcn, hand-build every primitive on bare Tailwind.** Rejected: re-solves
  accessible overlays/menus that shadcn already provides; only the genuinely
  design-specific primitives (AIPanel, Section, FieldRow, LiveDot) are bespoke.

## Consequences

- M6 has a concrete build contract: import `tokens.css`, apply the Tailwind theme
  (§1) and shadcn alias layer (§2), `init` shadcn, then adopt components per the
  inventory (§7) with the four global overrides (§4). The `--accent` collision and
  the direct-reference/no-alpha decision (§5) are the two non-obvious traps, now
  documented.
- The AIPanel remains a hard, bespoke contract (fenced AI output). Its shadcn-free
  status is intentional and load-bearing for user trust.
- **No code changes in this ADR.** `apps/dashboard/tailwind.config.js` and
  `global.css` are still the Nx defaults; wiring them is the first M6 task. The
  config blocks here are the reference for that task.
- Several inventory rows depend on still-open design questions — mobile chrome
  (#390), wallet states (#391), empty states (#392), AI-panel error states (#393),
  notifications (#394). Those resolve the _content_ of the components; this ADR
  fixes their _technology mapping_.
- SPEC §10.8 acceptance criteria are amended (Figma → committed HTML mocks; the
  shadcn mapping now lives in this ADR).
