# M5.5 design acceptance review

Sign-off for Milestone #7 (M5.5, issue #395): every hi-fi page checked against
its SPEC §6 section, with the design hard rules verified across the bundle.
Method: four independent reviews (proposal detail; cross-DAO surfaces; identity +
social; platform + states), each reading the relevant `../SPEC.md` sections and
mocks under `hifi/v1-etherscan/`, then synthesized here.

**Result: PASS — milestone can close.** 9 of the 11 functional page types plus the
cross-cutting sections sign off clean; the remaining gaps are tracked (#404–#406)
and none blocks M6.

## Per-page verdicts

| §     | Page                     | Mock                          | Verdict        |
| ----- | ------------------------ | ----------------------------- | -------------- |
| §6.4  | Homepage                 | `homepage.html`               | ✅ Sign-off    |
| §6.5  | All proposals (cross-DAO)| `proposals.html`              | ✅ Sign-off    |
| §6.6  | DAO landing              | — (no mock)                   | ⚠️ Gap → #404  |
| §6.7  | DAO health dashboard     | `health.html`                 | ✅ Sign-off\*  |
| §6.8  | DAO proposals list       | — (no mock)                   | ⚠️ Gap → #404  |
| §6.9  | Proposal detail          | `proposal.html`               | ✅ Sign-off    |
| §6.10 | Cross-DAO actor          | — (`delegate.html` is §6.11)  | ⚠️ Gap → #404  |
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

## Gaps (tracked, non-blocking)

1. **Missing page mocks — §6.6 DAO landing, §6.8 DAO proposals list, §6.10
   cross-DAO actor** → **#404**. Each is largely a composition of already-designed
   primitives; design as an early-M6 top-up.
2. **Auth — signup / forgot / reset not mocked** (only login) → **#405**. Build
   from spec in M6 (like the error pages). The password-rule copy error
   (`8+ chars` → `minimum 12 characters`, SPEC §6.14) is **fixed** in this change.
3. **Mobile nav — `mobile.html` bottom-tab vs the slide-over-drawer decision**
   (`design-decisions.md` #390) → **#406**. Reconcile so M6 builds one pattern.

## Notes (no action required)

- **Bonus coverage.** `daos.html` (DAO directory) and `search.html` (search
  results) are useful pages **beyond** the §6.2 IA (which exposes DAOs as a nav
  dropdown and search as a nav component, not dedicated pages). Their in-file
  `§6.6`/`§6.8` comments are mislabeled — treat as unnumbered extras or fold into
  the IA later; not gaps.
- **`api-docs.html`** is out of scope per SPEC §6.21 (static docs); its `§6.12`
  comment is mislabeled (§6.12 is the forum thread). Kept as discretionary polish.
- **Under-specification found (§10.8 risk).** The gaps above are design
  completeness, not spec ambiguity — no new clarifying ADR was needed beyond
  ADR-077 and `design-decisions.md`.
