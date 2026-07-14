# M5.5 design acceptance review

Sign-off for Milestone #7 (M5.5, issue #395): every hi-fi page checked against
its SPEC §6 section, with the design hard rules verified across the bundle.
Method: four independent reviews (proposal detail; cross-DAO surfaces; identity +
social; platform + states), each reading the relevant `../SPEC.md` sections and
mocks under `hifi/v1-etherscan/`, then synthesized here.

**Result: PASS — milestone can close.** Every functional page type and the
cross-cutting sections sign off clean. The three page mocks originally missing
(§6.6, §6.8, §6.10) were subsequently built and the mobile nav reconciled
(closing #404 and #406); the one remaining item, the auth signup/forgot/reset
flows (#405), is a deliberate build-from-spec deferral to M6.

> **Update (post-review).** #404 and #406 are now resolved — see "Resolution" below.
> The per-page verdicts and gap list are preserved as the review record.

## Per-page verdicts

| §     | Page                     | Mock                          | Verdict        |
| ----- | ------------------------ | ----------------------------- | -------------- |
| §6.4  | Homepage                 | `homepage.html`               | ✅ Sign-off    |
| §6.5  | All proposals (cross-DAO)| `proposals.html`              | ✅ Sign-off    |
| §6.6  | DAO landing              | `dao.html`                    | ✅ Sign-off (added) |
| §6.7  | DAO health dashboard     | `health.html`                 | ✅ Sign-off\*  |
| §6.8  | DAO proposals list       | `dao-proposals.html`          | ✅ Sign-off (added) |
| §6.9  | Proposal detail          | `proposal.html`               | ✅ Sign-off    |
| §6.10 | Cross-DAO actor          | `actor.html`                  | ✅ Sign-off (added) |
| §6.11 | Delegate scorecard       | `delegate.html`               | ✅ Sign-off\*  |
| §6.12 | Forum thread             | `forum.html`                  | ✅ Sign-off    |
| §6.13 | Developer dashboard      | `developer.html`              | ✅ Sign-off    |
| §6.14 | Authentication           | `auth.html`                   | ⚠️ Partial → #405 |
| §6.15 | Error / edge-case pages  | `States Wireframe.html`       | ✅ Sign-off (wireframe, per §10.8) |

Cross-cutting sections: **§6.16 real-time** (10s tally polling + freshness
indicator), **§6.18 AI output** (fenced, attributed, provenance one click away),
**§6.17 Lido dual-track** (source-explicit voting power), **§6.19 a11y +
responsive** — all ✅ sign-off.

\* Minor, non-blocking: `health.html` renders concentration/participation as
sparklines + tables rather than the §6.7 delegation-flow directed graph, and the
90d/1y/all time-range selector isn't shown. `delegate.html` substitutes a tabular
vote record for the §6.11 VP-trajectory sparkline + participation calendar. Both
are acceptable at mock fidelity; flagged for M6.

## Hard rules — verified across the bundle

All pages pass: AI output always fenced in `<AIPanel>` (△ mark + model/inputs
footer); severity is exactly three colours (`ok`/`note`/`warn`, no info-blue);
mono for facts / sans for prose; squared-off (radius only on avatars, dots,
pills); borders not shadows (1.5px AI-panel exception intentional); tabular
numerics on every number column; the §6.3 delegate identity chip and voting-power
figure render per contract.

## Gaps found by the review (record)

1. **Missing page mocks — §6.6 DAO landing, §6.8 DAO proposals list, §6.10
   cross-DAO actor** → **#404**. _Resolved — see below._
2. **Auth — signup / forgot / reset not mocked** (only login) → **#405**. Build
   from spec in M6 (like the error pages). The password-rule copy error
   (`8+ chars` → `minimum 12 characters`, SPEC §6.14) is **fixed**.
3. **Mobile nav — `mobile.html` bottom-tab vs the slide-over-drawer decision**
   (`design-decisions.md` #390) → **#406**. _Resolved — see below._

## Resolution

- **#404 — closed.** The three missing mocks were built against the design system:
  `dao.html` (§6.6 DAO landing), `dao-proposals.html` (§6.8 DAO proposals list),
  `actor.html` (§6.10 cross-DAO actor, incl. the cross-DAO alignment heatmap that
  distinguishes it from the §6.11 scorecard). Every functional page type now has a
  mock.
- **#406 — closed.** `mobile.html` now shows the **slide-over drawer** (open state
  in the first phone frame, opened by the top-bar `≡`); the bottom tab bar and its
  prose references are removed, matching `design-decisions.md` #390.
- **#405 — deferred to M6 by decision** (build signup/forgot/reset from the §6.14
  spec, as with the error pages). The password copy error is already fixed.
- The mislabeled section comments in `daos.html` / `search.html` / `api-docs.html`
  were corrected.

## Notes (no action required)

- **Bonus coverage.** `daos.html` (DAO directory) and `search.html` (search
  results) are useful pages **beyond** the §6.2 IA (which exposes DAOs as a nav
  dropdown and search as a nav component, not dedicated pages). Kept as unnumbered
  extras; comments corrected.
- **`api-docs.html`** is out of scope per SPEC §6.21 (static docs). Kept as
  discretionary polish; comment corrected.
- **Under-specification found (§10.8 risk).** The gaps above are design
  completeness, not spec ambiguity — no new clarifying ADR was needed beyond
  ADR-077 and `design-decisions.md`.
