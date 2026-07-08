# Kvorum — engineering handoff

For: the dev team building Kvorum in Next.js.
From: design.

> **Stack note.** These mocks are the layout + interaction reference. The build
> uses **Tailwind + shadcn/ui** (SPEC §10.9), not CSS Modules — see **ADR-077**
> for the token → Tailwind theme and primitive → shadcn mapping, and
> `DESIGN-NOTES.md` for the design rationale and hard visual rules.

## Start here

1. Read `DESIGN-NOTES.md` — design rationale, hard rules, and component naming map.
2. Open `design-system/components.html` in a browser — visual reference for every primitive.
3. Read `design-system/README.md` for design rationale.
4. Skim `../SPEC.md` — every screen below is annotated with its `§N.N` section.
5. Read `README.md` (this folder) for the page-by-page index.

## What's in this repo

```
docs/design/
├── README.md                   ← page-by-page index (start here)
├── DESIGN-NOTES.md             ← design rationale, hard rules, component map
├── HANDOFF.md                  ← you are here
├── index.html                  ← browsable package landing
├── design-system/
│   ├── tokens.css              ← color/type/space/motion vars
│   ├── components.css          ← class-based component primitives
│   ├── components.html         ← visual reference (open me)
│   └── README.md               ← rationale + principles
├── hifi/
│   └── v1-etherscan/           ← hi-fi mocks for every page type (V1, the chosen direction)
├── brand/                      ← logo/wordmark/favicon/OG + Logo component
└── *Wireframe.html             ← lo-fi wireframes (one per screen, complete coverage)
```

The product spec lives at `../SPEC.md` (repo root), not inside this folder.

## Hi-fi vs. wireframes

- **Hi-fi (all page types)** — `hifi/v1-etherscan/*.html`. One mock per page type; this is the visual + interaction target. Build to this fidelity. (`proposal-system.html` is the proposal-detail mock annotated with design-system callouts.)
- **Wireframes** — `*Wireframe.html`. Correct *information architecture* and *layout*; kept for reference. The error/empty/loading states (`States Wireframe.html`) are intentionally wireframe-only and built directly from spec (§10.8).

## Spec → screen map

Mapped to the actual SPEC §6.2 IA (section labels corrected in the acceptance review). See `README.md` for the clickable index.

| §     | Spec section              | Hi-fi                                       |
| ----- | ------------------------- | ------------------------------------------- |
| §6.4  | Homepage                  | `hifi/v1-etherscan/homepage.html` ✓         |
| §6.5  | All proposals (cross-DAO) | `hifi/v1-etherscan/proposals.html` ✓        |
| §6.6  | DAO landing               | `hifi/v1-etherscan/dao.html` ✓              |
| §6.7  | DAO health dashboard      | `hifi/v1-etherscan/health.html` ✓           |
| §6.8  | DAO proposals list        | `hifi/v1-etherscan/dao-proposals.html` ✓    |
| §6.9  | **Proposal detail**       | **`hifi/v1-etherscan/proposal.html`** ✓     |
| §6.10 | Cross-DAO actor           | `hifi/v1-etherscan/actor.html` ✓            |
| §6.11 | Delegate scorecard        | `hifi/v1-etherscan/delegate.html` ✓         |
| §6.12 | Forum thread              | `hifi/v1-etherscan/forum.html` ✓            |
| §6.13 | Developer dashboard       | `hifi/v1-etherscan/developer.html` ✓        |
| §6.14 | Auth (login)              | `hifi/v1-etherscan/auth.html` ✓ (signup/forgot/reset → M6, #405) |
| §6.15 | Empty / error states      | `States Wireframe.html` (wireframe, per §10.8) |
| —     | Mobile (proposal)         | `hifi/v1-etherscan/mobile.html` ✓ (slide-over drawer) |

Bonus pages beyond the §6.2 IA: `daos.html` (DAO directory), `search.html` (search results), `api-docs.html` (static docs, §6.21 out of scope).

## Suggested build order

1. **App shell** — `<TopNav>`, `<Crumb>`, `<FreshFooter>`. Wired into `app/layout.tsx`. Light/dark theme toggle persists to `localStorage`.
2. **Proposal detail (§6.9)** — port `hifi/v1-etherscan/proposal.html` to `app/proposals/[id]/page.tsx`. Each `/* --- ... --- */` section comment in the source maps to one component.
3. **Cross-DAO proposals list (§6.5)** — feeds the detail page. Reuse `<Pill>`, `<StatePill>`, `<VoteTag>`.
4. **Homepage (§6.4)** — entry surface. Heaviest reuse of existing primitives.
5. **Then expand** — DAO directory, search, delegate profiles, etc., in priority order.

The proposal detail is the most complex screen. If the system holds up there, the rest are mostly composition.

## Porting an HTML mock to Next.js

The mocks are single-file HTML with `/* --- Section name --- */` comments that
map each block to one component. The **implementation stack is Tailwind + shadcn/ui
per ADR-077**, so treat the mock as the layout/behaviour spec, not code to copy:

1. Find the `/* --- Section name --- */` block for the section you're building.
2. Build the component with the shadcn primitive (or bespoke) from the ADR-077
   inventory; express layout with Tailwind utilities.
3. Never hard-code hex — the mock's colours all correspond to `tokens.css`
   variables, surfaced as Tailwind theme colours (`bg-accent`, `text-warn`, …).
4. If a mock colour has no matching token — stop, add the token to `tokens.css`
   (light + dark), then continue.

## Open questions for design — resolved

These are now settled in [`design-decisions.md`](design-decisions.md):

- **Mobile chrome** — top bar + slide-over drawer, search promoted to the bar; full per-page mobile hi-fi defers to v1.1 (KNOWN-019). _Resolved (v1)._
- **Wallet states** — SIWE flow states specced (connecting / wrong-chain / signature-pending / connected / error) within the severity vocabulary. _Resolved (v1)._
- **Empty state for new DAOs** — squared empty-state card, distinct from loading/error. _Resolved (v1)._
- **AI panel error states** — stale / rate-limited / failed, all kept inside the fenced `AIPanel`. _Resolved (v1)._
- **Notifications** — out of v1; in-app bell + email digests recorded for v1.1. _Deferred._

## Versioning

Design system pre-1.0. Update `components.html` first when you add a primitive — that's the test of "is this generalizable?". If you can't render it cleanly in the reference, it isn't a primitive yet.
