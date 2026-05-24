# M1 Backfill Runbook — Compound GovernorBravo historical fill

**Scope:** GovernorBravoDelegator (`0xc0Da02939E1441F497fd74F78cE7Decb17B66529`) on Ethereum mainnet.  
**Issue:** [#42 — I3. Run historical Compound backfill + validate acceptance #1 + #4](https://github.com/EugeneButusov/kvorum/issues/42)  
**Plan:** `docs/planning/plan-m1-i3.md`

GovernorAlpha-era proposals (~1–42, 2020 → May 2021) are explicitly out of M1 scope; see plan decision #2.

---

## Helpers

```bash
# psql shorthand — no local install needed
alias psql='docker exec -i kvorum-postgres-1 psql -U kvorum -d kvorum'

# ClickHouse shorthand
alias chsql='docker exec -i kvorum-clickhouse-1 clickhouse-client'
```

---

## Pre-run: record reference counts (fill before starting the backfill)

These values must be written here **before** `backfill start` so they cannot be back-fitted.

| Field               | Value    |
| ------------------- | -------- |
| `REF_BRAVO_BINDING` | 539      |
| `REF_AS_OF_BLOCK`   | 25108665 |
| `reorg_margin`      | 5        |

Pass gate (acceptance #1): `count ≥ 0.95 × REF_BRAVO_BINDING` AND `count ≤ REF_BRAVO_BINDING + reorg_margin`.

---

## Phase 1 — Pre-flight checks

```bash
# Verify CH free space (Bravo archive is small, ~hundreds of rows, but check anyway)
chsql --query "SELECT formatReadableSize(free_space) FROM system.disks"

# Confirm migration ran and active_from_block is set correctly
psql -c "SELECT source_type, active_from_block FROM dao_source WHERE source_type='compound_governor_bravo'"
# Expected: active_from_block = 12006099
```

---

## Phase 2 — Execution run

### Step 1 — Infra up

```bash
docker compose up -d postgres clickhouse redis
# anvil only needed for the fallback path
```

### Step 2 — Migrate

```bash
pnpm -w db:migrate        # applies core + compound_001/002/003
pnpm -w db:migrate:ch     # CH archive table

# Verify
psql -c "SELECT source_type, active_from_block FROM dao_source WHERE source_type='compound_governor_bravo'"
```

### Step 3 — Export env

```bash
# Source vault-provisioned vars per ADR-028. Never commit real values.
# infra/scripts/provision-env.sh populates CHAIN_CONFIG, HMAC_PEPPER_CURRENT, etc.
export $(grep -v '^#' .env | grep -v '^$' | xargs)  # load .env into shell

export CHAIN_CONFIG='...'   # mainnet, ≥2 providers (from vault)
export HMAC_PEPPER_CURRENT='...'

# Optional: lower intervals for faster drain (default: 5000 / 10000 ms)
export DERIVATION_INTERVAL_MS=2000
export INDEXER_CALLDATA_DECODE_INTERVAL_MS=2000
```

### Step 4 — Bootstrap read path FIRST (before the ~30-min backfill)

```bash
# Start apps/api in another terminal
# Create test user (existing path) then mint acceptance key
admin-cli keys create <user_id> --format json
# Store the returned key for step 9 validation
API_KEY=<key>
```

### Step 5 — Start apps/indexer with live poller DISABLED

```bash
# In a separate terminal
INDEXER_LIVE_POLLER_ENABLED=false \
OTEL_SERVICE_NAMESPACE=kvorum \
  pnpm --filter indexer start

# Assert gate is off — look for this in the boot log:
# [IndexerOrchestrator] live_poller_enabled=false
# [IndexerOrchestrator] Live EventPoller disabled …

# Confirm /metrics on OPS_PORT responds
curl http://localhost:9091/metrics | head -3
```

### Step 6 — Dry-run then run the backfill

```bash
# Dry-run: assert resolved from_block = 12006099
admin-cli backfill start compound_governor_bravo --dry-run --format json

# Snapshot state before crash-resume test (mid-run)
# S_pre_count = archive_event row count
# S_pre_hash  = sha256 of sorted (source_type, chain_id, tx_hash, log_index, block_hash) 5-tuples

# Start the actual run (~30 min wall-clock)
admin-cli backfill start compound_governor_bravo --format json

# --- CRASH-RESUME SPOT-CHECK (once, mid-run) ---
# 1. Record S_pre (count + 5-tuple hash)
# 2. Ctrl-C (SIGINT)
# 3. Resume: admin-cli backfill start compound_governor_bravo --format json
# 4. Assert:
#    a. resumed from backfill_head_block+1, backfill_started_at_block unchanged (ADR-027/046/047)
#    b. after completed: final 5-tuple set ⊇ S_pre, zero duplicate 5-tuples,
#       final proposal count = acceptance-#1 count (determinism gate)
```

**Run results:**

| Field                                 | Value                               |
| ------------------------------------- | ----------------------------------- |
| Run started at                        | _(timestamp)_                       |
| Run completed at                      | _(timestamp)_                       |
| Wall-clock duration                   | _(minutes)_                         |
| `backfill_head_block` at completion   | _(block)_                           |
| `cutoff_block`                        | _(block)_                           |
| `backfill_head_block == cutoff_block` | _(yes/no)_                          |
| Crash-resume performed?               | _(yes/no — if yes, capture output)_ |
| RPC provider failovers observed       | _(yes/no; which provider)_          |
| DLQ entries after run                 | _(count)_                           |

### Step 7 — Drain wait (four-part stop condition)

Declare drain complete only when **all four** hold across **≥3 consecutive polls ≥60 s apart**.

Max-drain budget: _(record value, e.g. 60 min post-backfill-completion)_

```bash
# (a) backfill not in progress AND head == cutoff
psql -c "SELECT backfill_started_at_block, backfill_head_block FROM dao_source WHERE source_type='compound_governor_bravo'"
# Expected once drained: backfill_started_at_block = null, backfill_head_block = cutoff_block recorded above

# (b) derivation backlog = 0
psql -c "
  SELECT
    (SELECT count(*) FROM archive_event WHERE source_type='compound_governor_bravo') AS archived,
    (SELECT count(*) FROM proposal           WHERE source_type='compound_governor_bravo') AS derived,
    (SELECT count(*) FROM archive_event WHERE source_type='compound_governor_bravo')
      - (SELECT count(*) FROM proposal       WHERE source_type='compound_governor_bravo') AS backlog
"

# (c) every proposal_action has had ≥1 decode attempt
psql -c "
  SELECT count(*) AS undecoded_no_attempt
  FROM proposal_action pa
  JOIN proposal p ON p.id = pa.proposal_id
  WHERE p.source_type = 'compound_governor_bravo'
    AND pa.decode_attempt_count = 0
"
# Target: 0

# (d) if budget exceeded with backlog > 0: stop and investigate
```

**Drain results:**

| Poll | Time | Archived | Derived | Backlog | Undecoded-no-attempt | All-four? |
| ---- | ---- | -------- | ------- | ------- | -------------------- | --------- |
| 1    |      |          |         |         |                      |           |
| 2    |      |          |         |         |                      |           |
| 3    |      |          |         |         |                      |           |

### Step 8 — Enable the live EventPoller post-drain

```bash
# Restart apps/indexer without the gate flag (default = true)
# Assert boot log now shows: [IndexerOrchestrator] live_poller_enabled=true
OTEL_SERVICE_NAMESPACE=kvorum pnpm --filter indexer start
```

### Step 9 — Validation

See acceptance criteria below. Use `API_KEY` minted in step 4.

After validation, run the collect script to patch this file with real values:

```bash
DAO_SOURCE_ID=$(psql -Atc "SELECT id FROM dao_source WHERE source_type='compound_governor_bravo'") \
  ./infra/scripts/collect-backfill-results.sh
```

---

## Acceptance evidence

### #1 — Historical binding proposals (Bravo-era)

```bash
# Paginate through all binding terminal-state proposals
# state filter = executed,defeated,canceled,expired (complete set for Bravo — ADR-031)
# (no 'vetoed' state for Compound)
curl -H "Authorization: Bearer $API_KEY" \
  'http://localhost:3001/v1/daos/compound/proposals?state=executed,defeated,canceled,expired&limit=200'
# Follow cursor pages, sum total count

# Cross-check via SQL
psql -c "
  SELECT count(*) FROM proposal
  WHERE source_type='compound_governor_bravo'
    AND state IN ('executed','defeated','canceled','expired')
"
```

| Metric                                      | Value |
| ------------------------------------------- | ----- |
| API count (paginated)                       |       |
| SQL count                                   |       |
| REF_BRAVO_BINDING (pre-recorded)            | 539   |
| `count ≥ 0.95 × REF_BRAVO_BINDING`?         |       |
| `count ≤ REF_BRAVO_BINDING + reorg_margin`? |       |
| **Gate passed?**                            |       |

### #4 — Calldata decode rate ≥95% (action-level)

```bash
psql -c "
  SELECT
    count(*) FILTER (WHERE pa.decoded_function IS NOT NULL) AS decoded,
    count(*) AS total,
    round(
      100.0 * count(*) FILTER (WHERE pa.decoded_function IS NOT NULL) / nullif(count(*), 0),
      2
    ) AS action_level_pct
  FROM proposal_action pa
  JOIN proposal p ON p.id = pa.proposal_id
  WHERE p.source_type = 'compound_governor_bravo'
    AND p.state IN ('executed','defeated','canceled','expired')
"

# Per-target miss histogram (targets with any undecoded actions)
psql -c "
  SELECT pa.target_address, count(*) AS undecoded
  FROM proposal_action pa
  JOIN proposal p ON p.id = pa.proposal_id
  WHERE p.source_type = 'compound_governor_bravo'
    AND p.state IN ('executed','defeated','canceled','expired')
    AND pa.decoded_function IS NULL
  GROUP BY pa.target_address
  ORDER BY undecoded DESC
"
```

| Metric                                                   | Value |
| -------------------------------------------------------- | ----- |
| Action-level decode rate                                 |       |
| `rate ≥ 0.95`?                                           |       |
| If 0.90–0.95: every miss mapped to named/ticketed cause? |       |
| **Gate passed?** (< 0.90 always blocks M1)               |       |

### #2 — New proposal ≤ 4 min (post-drain, deliberate check)

```bash
# After step 8 (poller re-enabled), observe for a new ProposalCreated event.
# If one lands: assert it appears in API within 4 min.
# If none in the window: record as "not exercised — covered by F live-ingestion tests".
```

Result: _(exercised / not exercised)_

### admin-cli status sanity

```bash
admin-cli status --format json
```

Expected fields (real names — `last_archived_event_age` does NOT exist):

- `ingestion_idle_for_seconds`: low (seconds, not hours)
- `dlq_size`: 0 or low
- `active_backfills`: 0 after completion
- `last_reorg_detected_at`: plausible timestamp for mainnet
- `last_archived_event_at`: recent

Result: _(paste JSON output)_

### Backfill/live overlap — zero duplicate proposals

```bash
psql -c "
  SELECT dao_id, source_type, source_id, count(*) AS cnt
  FROM proposal
  WHERE source_type = 'compound_governor_bravo'
  GROUP BY 1, 2, 3
  HAVING count(*) > 1
"
# Expected: 0 rows
```

### CH/PG archive integrity (ADR-038 / ADR-041)

```bash
# CH count (FINAL for ReplacingMergeTree dedup)
chsql --query "SELECT count() FROM archive_event_compound_governor_bravo FINAL"

# PG count
psql -c "SELECT count(*) FROM archive_event WHERE source_type='compound_governor_bravo'"

# DLQ size
psql -c "SELECT count(*) FROM dlq WHERE source_type='compound_governor_bravo'"

# Assert: CH_count >= PG_count AND (CH_count - PG_count) == DLQ_size
```

| Metric                          | Value |
| ------------------------------- | ----- |
| CH count (FINAL)                |       |
| PG count                        |       |
| DLQ size                        |       |
| `CH ≥ PG AND (CH − PG) == DLQ`? |       |

### Known-proposal sanity (scoped per decision #6)

Pick a well-known Bravo proposal (e.g., a COMP distribution or market-add proposal).  
Use the **3-segment** detail route: `GET /v1/daos/compound/proposals/compound_governor_bravo/<source_id>`  
(A plain `/proposals/<id>` 404s.)

```bash
curl -H "Authorization: Bearer $API_KEY" \
  'http://localhost:3001/v1/daos/compound/proposals/compound_governor_bravo/<source_id>'
```

Cross-check vs Tally/Etherscan:

| Field                                                             | Expected (from Tally/Etherscan)                     | Actual |
| ----------------------------------------------------------------- | --------------------------------------------------- | ------ |
| `proposer`                                                        |                                                     |        |
| `state`                                                           |                                                     |        |
| `voting_power_block` (= `startBlock`)                             |                                                     |        |
| `voting_starts_block` (= `startBlock`)                            |                                                     |        |
| `voting_ends_block` (= `endBlock`)                                |                                                     |        |
| `voting_starts_at` / `voting_ends_at`                             | NULL (M1 — ADR-043)                                 |        |
| `title` (ADR-030: first non-empty line, `#` stripped, ≤200 chars) |                                                     |        |
| `proposal_choice` rows                                            | 3 rows: `(0,Against),(1,For),(2,Abstain)` (ADR-039) |        |
| `actions[0].decoded_function`                                     | _(from Etherscan)_                                  |        |

---

## Phase 3 — Capture & forward-links

- [ ] Fill "Run results" sections above with real command output (or run `infra/scripts/collect-backfill-results.sh`)
- [ ] If acceptance #4 < 95%: record per-target miss histogram; open G follow-up issue; apply contingency decision tree from plan (action-level < 0.90 blocks M1)
- [x] GovernorAlpha follow-up issue opened: [#110](https://github.com/EugeneButusov/kvorum/issues/110)
- [ ] File post-I3 M1-closeout checklist (separate from this runbook — plan decision #5)

---

## GovernorAlpha gap (explicit, not silently dropped)

Compound used GovernorAlpha (`0xc0dA01a04C3f3E0bE433606045bB7017A7323E38`) for proposals ~1–42 (2020 → ~May 2021). These are out of M1 scope. The acceptance-#1 count is against the Bravo-era total only. Tracked in [#110](https://github.com/EugeneButusov/kvorum/issues/110) (tentatively M2/M3).
