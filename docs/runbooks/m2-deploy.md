# M2 Deploy Notes

## K1 — VoteCast topic filter rollout

K1 adds `VoteCast` topic0 to Compound governor poller filters.

After deploy, restart indexer pollers so each source reloads filter topics at startup:

- `compound_governor_alpha`
- `compound_governor_bravo`
- `compound_governor_oz`

No live filter rotation exists; a process restart is required for the new topic set to take effect.
