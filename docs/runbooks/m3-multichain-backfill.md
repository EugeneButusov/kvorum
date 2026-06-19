# M3 Multi-chain Backfill Runbook — Aave v3 + v2

**Scope:** the full Aave historical backfill across all configured chains, driven by the
`admin-cli backfill run` orchestrator (Y1, [#268](https://github.com/EugeneButusov/kvorum/issues/268)).

Covers every backfill-capable Aave source:

- `aave_governance_v3` (mainnet `0x1`) — proposals + payload declarations
- `aave_governor_v2` (mainnet `0x1`) — legacy governor
- `aave_token` (mainnet `0x1`) — AAVE delegation
- `aave_voting_machine` (`0x1`, `0x89`, `0xa86a`) — votes
- `aave_payloads_controller` (14 chains incl. deprecated Metis `0x440`, zkSync `0x144`) — executions

Pairs with `docs/runbooks/m3-chains.md` (per-chain `CHAIN_CONFIG` / `headLag` provisioning) and
`docs/runbooks/gap-fill.md` (startup catch-up).

> **Backfill ≠ derived state.** `backfill run` writes `archive_event` (PG) + per-source ClickHouse
> archive rows only. Unified `proposal` / `vote` / `aave_proposal_payload` entities appear only
> after the **indexer derivation worker** processes those archive rows. Acceptance row-count checks
> (AC #1/#2) therefore require a running indexer alongside (or after) the backfill — see Phase 5.

---

## Helpers

```bash
alias psql='docker compose exec -T postgres psql -U kvorum -d kvorum'
alias chsql='docker compose exec -T clickhouse clickhouse-client'
```

---

## Phase 1 — Prerequisites

1. **`CHAIN_CONFIG` covers every configured chain** with at least one primary + one fallback
   provider, per `docs/runbooks/m3-chains.md`. A chain present among the Aave sources but missing
   from `CHAIN_CONFIG` is a readiness-gate failure (aborts the run).
2. **Sources are registered.** The R3 seed migration (`aave_002_seed.ts`, `aave_005_token.ts`)
   registers all rows. Confirm:
   ```bash
   psql -c "
     SELECT source_type, chain_id, active_from_block
     FROM dao_source ds JOIN dao d ON d.id = ds.dao_id
     WHERE d.slug = 'aave' AND source_type NOT LIKE '%\_reconcile'
     ORDER BY source_type, chain_id
   "
   ```
3. **Historical `eth_getLogs` access** on every chain (minor chains — Gnosis/BNB/Scroll/Celo/Sonic
   — are the risk). The readiness gate (Phase 2) probes this automatically before any writes.

---

## Phase 2 — Dry-run the plan + readiness gate

`--dry-run` prints the ordered plan and the per-chain readiness gate result and makes **zero**
writes. Always run this first.

```bash
admin-cli backfill run aave --dry-run
# add --skip-deprecated to exclude Metis/zkSync (backfill-only chains)
```

The plan is two-phase:

- **Phase 1 (serial mainnet spine):** `aave_governance_v3` → `aave_governor_v2` → `aave_token`.
- **Phase 2 (bounded-parallel):** the voting machines + payloads controllers across all chains.

**Readiness gate (owner-locked to abort the whole run on any failure):**

- missing `CHAIN_CONFIG` for a target chain, and
- per-source `eth_getLogs` depth probe at the source's `active_from_block`
  (a pruned / non-archive provider fails here).

Fix any reported failure (provider config, archive endpoint) and re-run the dry-run until the gate
reports **PASS**. `--skip-log-depth-check` bypasses the probe for trusted environments only.

---

## Phase 3 — Execute

```bash
admin-cli backfill run aave --concurrency 3
```

- **Ordering:** the mainnet spine runs serially first, then Phase 2 runs bounded-parallel
  (`--concurrency`, default 3). Ordering is an optimization, not a correctness requirement — the
  derivation indefinite-hold (ADR-065) tolerates any arrival order.
- **RPC pooling:** one `FailoverRpcClient` per chain is shared across all sources on that chain and
  torn down at the end.
- **Per-source mode (automatic):**
  - **resume** an in-flight source (captured head present),
  - **skip** a source whose archive already reaches the confirmed head,
  - else run **fresh**.
- **Partial-failure isolation:** if one source errors mid-run, it is recorded as `error` in the
  final summary and the rest continue. Re-run `backfill run aave` to retry just the failed/pending
  sources (completed ones skip; idempotent writes per ADR-041 make a re-scan safe regardless).

Watch the CLI's structured progress output (per-source `backfill_chunk_complete` lines). Backfill
runs in the ephemeral `admin-cli` process, so monitor via the CLI output + archive row counts
(Phase 4), not scraped Prometheus gauges.

### Cancellation (ADR-047)

`Ctrl-C` (SIGINT/SIGTERM) aborts at the next chunk boundary under one `AbortController`: the
in-flight source checkpoints its last completed chunk, queued sources do not start, and the summary
marks each source `completed` / `cancelled` / `error` / `skipped`. Re-run to resume cleanly.

---

## Phase 4 — Verify archive counts (per chain)

The per-source-type backfill-progress gauge does not distinguish chains, so verify per-chain
progress with archive row counts:

```bash
psql -c "
  SELECT ae.source_type, ae.chain_id, count(*) AS rows, max(ae.block_number) AS max_block
  FROM archive_event ae
  JOIN dao_source ds ON ds.id = ae.dao_source_id
  JOIN dao d ON d.id = ds.dao_id
  WHERE d.slug = 'aave'
  GROUP BY 1, 2
  ORDER BY 1, 2
"
```

Compare per-(source_type, chain) counts against on-chain truth (the per-chain reference counts are
recorded in the Y3 acceptance run).

---

## Phase 5 — Derive + acceptance

Backfill only fills the archive. To produce `proposal` / `vote` / `aave_proposal_payload` rows for
the AC row-count checks, run the indexer so the derivation worker drains the underived archive:

```bash
docker compose start indexer
# watch the underived backlog fall to zero
psql -c "
  SELECT source_type, chain_id, count(*)
  FROM archive_event
  WHERE derived_at IS NULL
  GROUP BY 1, 2 ORDER BY 1, 2
"
```

Cross-chain stitch holds (a vote/payload that arrived before its mainnet proposal) surface via
`indexer_stitch_pending_seconds` / `indexer_stitch_payload_pending_seconds` — see
`docs/runbooks/m3-chains.md` for the alerting query. These are derivation-time concerns; the
backfill itself never blocks on them.

Once the underived backlog reaches zero and the DLQ is clear, proceed to
`docs/runbooks/m3-acceptance.md` to validate AC #1–#8 against on-chain truth and sign off the M3 gate.

---

## DLQ

The four Aave v3 backfill sources route archive-write failures to the generic **`archive_event_stage`**
(`aave_governor_v2` keeps its own `aave_governor_v2_archive_write`). `archive_event_stage` is in
`ARCHIVE_STAGES`, so failures are retriable with `admin-cli dlq retry` — Y1 wired the v3 sources
into the shared backfill plugin registry, which is what resolves the retry listener for them.

```bash
psql -c "
  SELECT stage, count(*)
  FROM ingestion_dlq
  WHERE accepted_at IS NULL AND resolved_at IS NULL
  GROUP BY stage ORDER BY stage
"
# retry a specific row:
admin-cli dlq retry <dlq_id> --format json
```

> **Note (plan vs. code).** `docs/planning/plan-m3.md` (ADR-032 row) anticipated per-source archive
> DLQ stages `aave_archive_write` / `aave_vote_archive_write` / `aave_payload_archive_write`. Those
> were never implemented — the v3 sources share the generic `archive_event_stage`. Treat the
> plan-m3 stage names as a documentation erratum; no code change is required for Y1.

---

## Single-source operations

For a targeted resume or a one-chain re-run, address a single `(source_type, chain)` directly. A
multi-chain `source_type` requires `--chain`:

```bash
# resume just the Polygon voting machine
admin-cli backfill start aave_voting_machine --chain 0x89

# without --chain on a multi-chain source the CLI lists the registered chains and exits
admin-cli backfill start aave_payloads_controller
```

`backfill catch-up <source_type> --chain <id> --confirm` runs a startup-style gap fill for one
source (ADR-051).
