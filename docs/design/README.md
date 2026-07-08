# Kvorum design bundle

The version-controlled, **reference** design package for the Kvorum dashboard —
the layout + interaction source of truth for M6. Delivered as self-contained
HTML (not Figma; SPEC §10.8 amended by [ADR-077](../adr/0077-tailwind-shadcn-design-system-mapping.md)).

- **Browsable landing:** open [`index.html`](index.html) in a browser.
- **Design rationale + hard rules:** [`DESIGN-NOTES.md`](DESIGN-NOTES.md)
- **Engineering handoff:** [`HANDOFF.md`](HANDOFF.md)
- **Resolved design questions (mobile, wallet, empty/error, AI-panel, notifications):** [`design-decisions.md`](design-decisions.md)
- **M5.5 acceptance sign-off (per-page verdicts + gaps):** [`ACCEPTANCE.md`](ACCEPTANCE.md)
- **Stack contract (tokens → Tailwind, primitive → shadcn):** [ADR-077](../adr/0077-tailwind-shadcn-design-system-mapping.md)

> **Build stack.** These mocks are the visual/interaction target; the dashboard
> is built with **Tailwind + shadcn/ui** (SPEC §10.9), not the CSS Modules the
> mocks are authored in. ADR-077 is the translation contract.

## Page index

Each page type, its hi-fi mock, its wireframe, and its spec section (`../SPEC.md`).

| §     | Page                 | Hi-fi (build target)                                       | Wireframe                                                   |
| ----- | -------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| §6.4  | Homepage             | [homepage.html](hifi/v1-etherscan/homepage.html)          | [Homepage](Homepage%20Wireframe.html)                      |
| §6.5  | Cross-DAO proposals  | [proposals.html](hifi/v1-etherscan/proposals.html)        | [Proposals List](Proposals%20List%20Wireframe.html)        |
| §6.6  | DAO directory        | [daos.html](hifi/v1-etherscan/daos.html)                  | [DAOs Index](DAOs%20Index%20Wireframe.html)                |
| §6.7  | DAO health dashboard | [health.html](hifi/v1-etherscan/health.html)              | [DAO Health](DAO%20Health%20Dashboard%20Wireframe.html)    |
| §6.8  | Search results       | [search.html](hifi/v1-etherscan/search.html)              | [Search Results](Search%20Results%20Wireframe.html)        |
| §6.9  | **Proposal detail**  | [proposal.html](hifi/v1-etherscan/proposal.html)          | [Proposal Detail](Proposal%20Detail%20Wireframe.html)      |
| §6.10 | Actor / delegate     | [delegate.html](hifi/v1-etherscan/delegate.html)          | [Actor Profile](Actor%20Profile%20Wireframe.html)          |
| §6.11 | Forum thread         | [forum.html](hifi/v1-etherscan/forum.html)                | [Forum Thread](Forum%20Thread%20Wireframe.html)            |
| §6.12 | API docs             | [api-docs.html](hifi/v1-etherscan/api-docs.html)          | [API Docs](API%20Docs%20Wireframe.html)                    |
| §6.13 | Developer dashboard  | [developer.html](hifi/v1-etherscan/developer.html)        | [Developer](Developer%20Dashboard%20Wireframe.html)        |
| §6.14 | Auth                 | [auth.html](hifi/v1-etherscan/auth.html)                  | [Auth Pages](Auth%20Pages%20Wireframe.html)                |
| —     | Mobile (proposal)    | [mobile.html](hifi/v1-etherscan/mobile.html)              | [Mobile Breakpoints](Mobile%20Breakpoints%20Wireframe.html)|
| —     | Empty / error states | _wireframe only — built from spec (§10.8)_                | [States](States%20Wireframe.html)                          |

`proposal-system.html` is the proposal-detail mock annotated with design-system callouts.

## Design system

| File                                                        | What                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| [design-system/components.html](design-system/components.html) | **Visual reference** — every primitive rendered with markup |
| [design-system/tokens.css](design-system/tokens.css)       | Colour / type / space / motion tokens (light + dark)        |
| [design-system/README.md](design-system/README.md)         | Token rationale and principles                              |
| [DESIGN-NOTES.md](DESIGN-NOTES.md)                          | Hard rules + CSS-class → React-component naming map         |

## Brand

Logo, wordmark, favicon, and OG assets live in [brand/](brand/) (see
[brand/README.md](brand/README.md)). The web-facing assets (favicon, apple-touch
icon, OG card) are wired into `apps/dashboard` via Next's metadata-file convention.

## Non-designer quick check

Pick any row in the page index, open its **hi-fi** link to see what to build, and
read the **§** column against `../SPEC.md` for the behavioural requirements. The
`components.html` reference shows every reusable primitive those pages compose.
