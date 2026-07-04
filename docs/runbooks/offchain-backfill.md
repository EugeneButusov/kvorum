# Runbook — off-chain backfill (Snapshot + Discourse)

**Scope:** operator-driven, from-genesis backfill of the off-chain sources (`snapshot` proposals/votes via
the Snapshot GraphQL hub, `discourse_forum` threads via the Discourse HTTP API). EVM sources
(Aragon / Dual Governance / Easy Track / Snapshot delegation) use the block-range backfill — see
`backfill start`/`backfill run` for those.

> Status: this ships the backfill machinery + deterministic tests. The real full-history run + acceptance
> validation land in a later step. This runbook is the operator reference for the machinery.

## Model

Off-chain sources have no block lattice and no reorg plane (ADR-071), so backfill is not a block range.
It is a **bounded drain** of the same poll transport used for live ingestion, started from a genesis
cursor and run to **quiescence**:

- `PollResult` carries no `done` flag, so completion is inferred: the drain stops after **K consecutive
  ticks** (`--quiescence-ticks`, default **3**) that both return **zero items** and leave the **cursor
  unadvanced**. A conservative K avoids stopping at a transient sparse window.
- The persisted `off_chain_cursor` makes a partial run **resumable** — re-running continues where it
  left off. Idempotency at the sink (mutable-latest on `external_id` + `content_hash`) makes a re-fetch
  after a crash a no-op except for genuine edits.
- **Forward-only:** the Snapshot closed-proposal reconcile and the Discourse periodic re-crawl are
  disabled during backfill (they belong to live polling).
- `SIGINT`/`SIGTERM` cancels the run cleanly (ADR-047); the cursor is left at the last committed tick.

## Sinks

| Mode              | Flag       | Behaviour                                                                                                                                            | When                                                           |
| ----------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| enqueue (default) | —          | Sends items to the `off_chain_archive` pg-boss queue; the **indexer off-chain consumer must be running** to drain them. Exactly the live write path. | Normal operation alongside a running indexer.                  |
| direct            | `--direct` | Writes the archive in-process (same shared mutable-latest core as the consumer); no indexer needed; prints a completion count.                       | Self-contained one-shot backfill / CI / a box with no indexer. |

## Commands

Per-DAO (recommended — enumerates that DAO's EVM sources then its off-chain sources as phase 3):

```bash
admin-cli backfill run lido --dry-run          # shows Phase 1/2 (EVM) + Phase 3 (off-chain)
admin-cli backfill run lido                     # enqueue sink (indexer consumer drains)
admin-cli backfill run lido --direct            # self-contained
admin-cli backfill run lido --quiescence-ticks 5 --inter-tick-delay 500
```

Single off-chain source (a `source_type` like `snapshot` spans DAOs, so `--dao` disambiguates —
`--chain` is meaningless off-chain):

```bash
admin-cli backfill start snapshot --dao lido
admin-cli backfill start discourse_forum --dao lido --direct
```

## Rate limits + reliability

- **Snapshot:** 60 req/min/IP on the single hub (no production mirror — the client retries/backoffs).
  Provision `SNAPSHOT_API_KEY` before a large run to raise the limit; the client sends it automatically.
- **Discourse:** the anonymous API is rate-limited (50 req/10s, 200/min) and User-Agent-sensitive; the
  client throttles and sends a real UA.
- `--inter-tick-delay <ms>` (default 250) paces the drain between polls; raise it if you see `429`s.

## Environment

| Var                | Purpose                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `SNAPSHOT_API_KEY` | Optional Snapshot API key; raises the hub rate limit for the from-genesis sweep. |
| `DATABASE_URL`     | Postgres connection (cursor persistence + pg-boss for the enqueue sink).         |

## Verifying

- `off_chain_cursor` advances as the drain progresses; a completed drain leaves it near the source head.
- enqueue mode: watch the indexer `indexer_off_chain_archive_*` metrics + the `off_chain_archive` queue
  depth drain to zero.
- direct mode: the command prints `<N> items across <M> ticks` on completion.
- Row counts land in `archive_event` (off-chain rows: `external_id` set, `chain_id = 'off-chain'`) and
  the per-source CH archive (`archive_event_snapshot`, etc.).
