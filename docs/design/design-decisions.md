# Design decisions — open questions resolved

Resolutions for the open questions `HANDOFF.md` left for design (M5.5). Each is a
product/UX call, not an import. They give M6 a build target where one is needed
and record a deliberate deferral where it isn't. Visual choices obey the hard
rules in [`DESIGN-NOTES.md`](DESIGN-NOTES.md) and the stack contract in
[ADR-077](../adr/0077-tailwind-shadcn-design-system-mapping.md). Spec references
are to `../SPEC.md`.

Status key: **Resolved (v1)** — build in M6 · **Deferred (v1.1)** — out of M6 scope,
recorded so nothing assumes it exists.

---

## 1. Mobile chrome — nav pattern (#390) · Resolved (v1)

**Decision.** Top bar + **slide-over drawer** (hamburger) for primary navigation,
with **search promoted into the top bar** as a persistent affordance. Not a
bottom tab bar.

**Why.** Kvorum has many top-level destinations (homepage, proposals, DAOs,
health, search, delegates, developer) — more than a bottom tab bar cleanly holds
— and its audience (auditors, delegates, governance staff) treats cross-DAO
**search** as a primary task, so search earns a permanent slot rather than living
inside the drawer. A drawer scales to the full IA without collapsing the dense
desktop layout.

**M6 guidance.** shadcn `Sheet` for the drawer; the top bar keeps the wordmark, a
search trigger (expands to full-width input), and the theme toggle. `TopNav` gains
a responsive branch; desktop layout is unchanged.

**Scope.** This fixes the *pattern* only. Per KNOWN-019, full per-page mobile
hi-fi still **defers to v1.1** — proposal detail (`hifi/v1-etherscan/mobile.html`)
remains the one worked example; other pages reflow with the drawer + single-column
stacking until then. `mobile.html` now demonstrates the open drawer (first phone
frame); the earlier bottom-tab treatment was removed to match this decision (#406).

## 2. Wallet connection states (#391) · Resolved (v1)

**Decision.** Spec-level treatment for the SIWE flow (SPEC §6.14), rendered in the
`TopNav` wallet control plus a shadcn `Dialog`. States, all within the three-colour
severity vocabulary (no new colours):

| State                 | Treatment                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Disconnected          | `Connect wallet` button in TopNav.                                                             |
| Connecting            | Button shows spinner + `Connecting…`, disabled.                                                |
| Wrong chain           | `note`-severity banner in the dialog + `Switch to Ethereum` action; TopNav button shows a `note` dot. |
| Signature pending     | Dialog: `Check your wallet — sign to continue`, shows the SIWE statement; cancel available.    |
| Rejected / error      | `warn`-severity message + `Try again`.                                                         |
| Connected             | TopNav shows the delegate identity chip (avatar + ENS/truncated address); dropdown → disconnect. |

**M6 guidance.** Email/password is the fallback path per §6.14; the same Dialog
hosts both. Reuse the `IdentityChip` and severity `Banner` from the ADR-077
inventory.

## 3. Empty state — zero-proposal DAO (#392) · Resolved (v1)

**Decision.** A DAO with no proposals renders a squared empty-state card on both
the DAO landing (§6.7) and any DAO-scoped proposal list (§6.5): mono headline
`No proposals yet`, a sans line explaining Kvorum surfaces proposals as they are
recorded on-chain, and the freshness indicator (last sync). No illustration.

**Distinct from neighbours.** Empty (genuine, above) ≠ loading (`Skeleton`) ≠ error
(`warn` state with retry). All three share the `States Wireframe.html` vocabulary;
M6 builds the trio together.

## 4. AI panel error states (#393) · Resolved (v1)

**Decision.** The `AIPanel` stays **fenced in every state** — △ mark, hatch,
1.5px border, `aria-label="AI generated content"`. Degraded output never leaks as
un-fenced prose (the fencing contract in DESIGN-NOTES §3 / ADR-077).

| State         | Inside the fence                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Loading       | Skeleton lines; footer keeps model + inputs.                                                            |
| Stale         | Last-good summary shown + a `note` freshness chip in the footer (`Generated N ago · inputs changed`); optional refresh. |
| Rate-limited  | `note` message `Summary temporarily unavailable (rate limit) — retrying`; no model output rendered.    |
| Failed        | `warn` message `Couldn’t generate a summary for this proposal` + link to the raw proposal description; no fabricated content. |

`note` = transient (stale/rate-limited), `warn` = failed. Pairs with the adaptive
polling in SPEC §6.16 / ADR-035.

## 5. Notifications (#394) · Deferred (v1.1)

**Decision.** **Out of scope for v1.** Neither SPEC §6 nor the mocks cover
notifications, and they are not on the M6 critical path.

**When it lands (v1.1).** Entry points: an in-app bell in `TopNav` and email
digests for watched DAOs/proposals. Recorded here so M6 does not assume a
notifications surface exists.
