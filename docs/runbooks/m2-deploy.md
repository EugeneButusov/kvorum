# M2 Deploy Notes

## K1 — VoteCast topic filter rollout

K1 adds `VoteCast` topic0 to Compound governor poller filters.

After deploy, restart indexer pollers so each source reloads filter topics at startup:

- `compound_governor_alpha`
- `compound_governor_bravo`
- `compound_governor_oz`

No live filter rotation exists; a process restart is required for the new topic set to take effect.

## N3 — ENS refresh operations note

If ENS RPC is unavailable for multiple hours, the scheduled refresh cycle no-ops and resumes on the next run. Treat this as best-effort metadata lag and monitor by absence of expected ENS-refresh metric updates during the outage window.
