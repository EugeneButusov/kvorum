# Kvorum — engineering handoff

For: the dev team building Kvorum in Next.js.
From: design.

## Start here

1. Read `CLAUDE.md` — project conventions for Claude Code and engineers alike.
2. Open `design-system/components.html` in a browser — visual reference for every primitive.
3. Read `design-system/README.md` for design rationale.
4. Skim `docs/PRD.md` — every screen below is annotated with its `§N.N` section.

## What's in this repo

```
.
├── CLAUDE.md                   ← agent + engineer rules of the road
├── HANDOFF.md                  ← you are here
├── design-system/
│   ├── tokens.css              ← color/type/space/motion vars
│   ├── components.css          ← class-based component primitives
│   ├── components.html         ← visual reference (open me)
│   └── README.md               ← rationale + principles
├── hifi/
│   └── v1-etherscan/
│       └── proposal.html       ← hi-fi proposal detail (V1 direction, the chosen one)
├── docs/
│   └── PRD.md                  ← product spec, source of truth
└── *Wireframe.html             ← lo-fi wireframes (one per screen, complete coverage)
```

## Hi-fi vs. wireframes

- **Hi-fi (1 screen)** — `hifi/v1-etherscan/proposal.html`. This is the visual + interaction target. Build to this fidelity.
- **Wireframes (everything else)** — `*Wireframe.html`. These have correct *information architecture* and *layout* but generic styling. Apply the design system to bring them up to hi-fi as you build.

## Spec → screen map

| §     | Spec section          | Wireframe                          | Hi-fi                                     |
|-------|-----------------------|------------------------------------|-------------------------------------------|
| §6.4  | Homepage              | `Homepage Wireframe.html`          | _todo — apply system_                     |
| §6.5  | Cross-DAO proposals   | `Proposals List Wireframe.html`    | _todo_                                    |
| §6.6  | DAO directory         | `DAOs Index Wireframe.html`        | _todo_                                    |
| §6.7  | DAO health dashboard  | `DAO Health Dashboard Wireframe.html` | _todo_                                 |
| §6.8  | Search results        | `Search Results Wireframe.html`    | _todo_                                    |
| §6.9  | **Proposal detail**   | `Proposal Detail Wireframe.html`   | **`hifi/v1-etherscan/proposal.html`** ✓   |
| §6.10 | Actor / delegate      | `Actor Profile Wireframe.html`     | _todo_                                    |
| §6.11 | Forum thread          | `Forum Thread Wireframe.html`      | _todo_                                    |
| §6.12 | API docs              | `API Docs Wireframe.html`          | _todo_                                    |
| §6.13 | Developer dashboard   | `Developer Dashboard Wireframe.html` | _todo_                                  |
| §6.14 | Auth                  | `Auth Pages Wireframe.html`        | _todo_                                    |
| —     | Mobile breakpoints    | `Mobile Breakpoints Wireframe.html` | _todo_                                   |
| —     | Empty / error states  | `States Wireframe.html`            | _todo_                                    |

## Suggested build order

1. **App shell** — `<TopNav>`, `<Crumb>`, `<FreshFooter>`. Wired into `app/layout.tsx`. Light/dark theme toggle persists to `localStorage`.
2. **Proposal detail (§6.9)** — port `hifi/v1-etherscan/proposal.html` to `app/proposals/[id]/page.tsx`. Each `/* --- ... --- */` section comment in the source maps to one component.
3. **Cross-DAO proposals list (§6.5)** — feeds the detail page. Reuse `<Pill>`, `<StatePill>`, `<VoteTag>`.
4. **Homepage (§6.4)** — entry surface. Heaviest reuse of existing primitives.
5. **Then expand** — DAO directory, search, delegate profiles, etc., in priority order.

The proposal detail is the most complex screen. If the system holds up there, the rest are mostly composition.

## Porting an HTML mock to Next.js

For each section in the source HTML:

1. Find its `/* --- Section name --- */` comment block in `<style>`.
2. Create `components/SectionName/SectionName.tsx` and `SectionName.module.css`.
3. Lift the markup. Replace class names with `styles.xxx` imports.
4. Replace any hard-coded color hex with `var(--…)` from `tokens.css`.
5. If you find a hex that doesn't have a token — stop, add the token, then continue.

## Open questions for design

These are intentionally unresolved — flag in PR review or async:

- **Mobile chrome** — wireframe has the breakpoints but no hi-fi yet. Hamburger? Bottom-tab? Search-first?
- **Wallet states** — connecting / wrong-chain / signature-pending visuals. Wireframe has placeholders.
- **Empty state for new DAOs** — what does the proposal list look like when a DAO has zero proposals?
- **Notifications** — neither wireframe nor hi-fi yet. Email + in-app?
- **AI panel error states** — what does the panel look like when summary fails / is rate-limited / is stale?

## Versioning

Design system pre-1.0. Update `components.html` first when you add a primitive — that's the test of "is this generalizable?". If you can't render it cleanly in the reference, it isn't a primitive yet.
