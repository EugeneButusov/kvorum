# M2 Backfill Runbook — Compound governors VoteCast replay + COMP token first backfill

**Scope:**

- `compound_governor_alpha` (`0xc0dA01a04C3f3E0be433606045bB7017A7323E38`)
- `compound_governor_bravo` (`0xc0Da02939E1441F497fd74F78cE7Decb17B66529`)
- `compound_governor_oz` (`0x309a862bbC1A00e45506cB8A802D1ff10004c8C0`)
- `compound_comp_token` (`0xc00e94Cb662C3520282E6F5717214004A7f26888`)

**Issue:** [#170 — K3](https://github.com/EugeneButusov/kvorum/issues/170)
**Plan:** `docs/planning/plan-m2-k3.md`

---

## Helpers

```bash
alias psql='docker compose exec -T postgres psql -U kvorum -d kvorum'
alias chsql='docker compose exec -T clickhouse clickhouse-client'
```

---

## Pre-run: record references BEFORE any backfill command

Record retrieval timestamp and source links before execution.

| Field                             | Value | Source              |
| --------------------------------- | ----- | ------------------- |
| `REF_ALPHA_VOTECAST_TOTAL`        |       | Tally compound page |
| `REF_BRAVO_VOTECAST_TOTAL`        |       | Tally compound page |
| `REF_OZ_VOTECAST_TOTAL`           |       | Tally compound page |
| `REF_COMP_DELEGATE_CHANGED`       |       | Tally/Etherscan     |
| `REF_COMP_DELEGATE_VOTES_CHANGED` |       | Tally/Etherscan     |
| `REF_RETRIEVAL_TIMESTAMP_UTC`     |       | ISO timestamp       |

Pass gates:

- Aggregate VoteCast per governor: within ±5% of `REF_*`.
- If `REF_* == 0`, archived count must be exactly `0`.
- Per-proposal sample (10 total): exact match for each sampled proposal.

---

## Phase 1 — Pre-flight checks

```bash
# CH free space
chsql --query "SELECT formatReadableSize(free_space) FROM system.disks"

# dao_source rows are present
psql -c "
  SELECT source_type, active_from_block, backfill_head_block
  FROM dao_source
  WHERE source_type IN (
    'compound_governor_alpha',
    'compound_governor_bravo',
    'compound_governor_oz',
    'compound_comp_token'
  )
  ORDER BY source_type
"

# expected: governor rows have backfill_head_block set (from M1);
# comp token has active_from_block=9601558 and backfill_head_block NULL

# indexer must be stopped before replay
ps aux | grep -E '[a]pps/indexer|apps/indexer/dist' || echo "OK: indexer process not running"
docker compose ps indexer | grep -q "Up" && echo "STOP indexer first" || echo "OK: indexer container stopped"
```

---

## Phase 2 — Execution

### Step A — Ensure empty unresolved DLQ before rehearsal

```bash
psql -c "
  SELECT stage, count(*)
  FROM ingestion_dlq
  WHERE accepted_at IS NULL AND resolved_at IS NULL
  GROUP BY stage
  ORDER BY stage
"
# expected: 0 rows
```

### Step B — Replay governors from current head (`--confirm-replay` required)

Run governors one-by-one: Alpha, then Bravo, then OZ.

```bash
ALPHA_HEAD=$(psql -Atc "SELECT backfill_head_block FROM dao_source WHERE source_type='compound_governor_alpha'")
echo "Alpha head: $ALPHA_HEAD"
time admin-cli backfill start compound_governor_alpha --from-block "$ALPHA_HEAD" --confirm-replay --format json
```

Calibration checkpoint after Alpha:

- If wall-clock >2x expected (~30 min baseline), pause before Bravo/OZ and recalibrate chunking/window.

```bash
BRAVO_HEAD=$(psql -Atc "SELECT backfill_head_block FROM dao_source WHERE source_type='compound_governor_bravo'")
echo "Bravo head: $BRAVO_HEAD"
time admin-cli backfill start compound_governor_bravo --from-block "$BRAVO_HEAD" --confirm-replay --format json

OZ_HEAD=$(psql -Atc "SELECT backfill_head_block FROM dao_source WHERE source_type='compound_governor_oz'")
echo "OZ head: $OZ_HEAD"
time admin-cli backfill start compound_governor_oz --from-block "$OZ_HEAD" --confirm-replay --format json
```

Why `--from-block <head>` and not `head+1`:

- M1 archived proposal events through `backfill_head_block`.
- K1 added VoteCast ingestion later.
- replay from `head` reprocesses already-archived proposal events idempotently and captures missing VoteCast.

### Step C — COMP token first full backfill

```bash
# no --from-block and no --confirm-replay needed
time admin-cli backfill start compound_comp_token --format json
```

### Step D — Drain stop condition

Poll until stable across 3 polls at least 60 seconds apart:

```bash
psql -c "
  SELECT source_type, event_type, count(*)
  FROM archive_confirmation
  WHERE source_type IN (
    'compound_governor_alpha',
    'compound_governor_bravo',
    'compound_governor_oz',
    'compound_comp_token'
  )
  GROUP BY 1,2
  ORDER BY 1,2
"
```

Expected event types:

- governors: `ProposalCreated`, `ProposalQueued`, `ProposalExecuted`, `ProposalCanceled`, `VoteCast`
- comp token: `DelegateChanged`, `DelegateVotesChanged`

### Step E — Re-enable live poller

```bash
docker compose start indexer
docker compose logs --since=30s indexer | grep -E 'block_poll|event_decoded'
```

---

## Acceptance evidence

### 1) Aggregate VoteCast counts per governor

```bash
chsql --query "
  SELECT count()
  FROM event_archive_compound_governor_bravo FINAL
  WHERE dao_source_id = (SELECT id FROM dao_source WHERE source_type='compound_governor_bravo')
    AND event_type = 'VoteCast'
"
# repeat for alpha and oz source_type filters
```

| Governor | Archived VoteCast | REF | Gate              |
| -------- | ----------------- | --- | ----------------- |
| Alpha    |                   |     | ±5% or exact-zero |
| Bravo    |                   |     | ±5% or exact-zero |
| OZ       |                   |     | ±5% or exact-zero |

### 2) 10-proposal sample exact match

For each preselected proposal id:

```bash
chsql --query "
  SELECT count()
  FROM event_archive_compound_governor_bravo FINAL
  WHERE dao_source_id = (SELECT id FROM dao_source WHERE source_type='compound_governor_bravo')
    AND event_type = 'VoteCast'
    AND JSONExtractString(payload, 'proposalId') = '<proposal_id>'
"
```

Any mismatch blocks M2 acceptance.

### 3) COMP token totals

```bash
chsql --query "
  SELECT event_type, count()
  FROM event_archive_compound_comp_token FINAL
  WHERE dao_source_id = (SELECT id FROM dao_source WHERE source_type='compound_comp_token')
  GROUP BY event_type
  ORDER BY event_type
"
```

### 4) Idempotency replay spot-check

```bash
DAO_SOURCE_ID=$(psql -Atc "SELECT id FROM dao_source WHERE source_type='compound_governor_bravo'")
COUNT_BEFORE=$(chsql --query "SELECT count() FROM event_archive_compound_governor_bravo FINAL WHERE dao_source_id='$DAO_SOURCE_ID' AND block_number BETWEEN 25000000 AND 25001000")

admin-cli backfill start compound_governor_bravo --from-block 25000000 --to-block 25001000 --confirm-replay --format json

COUNT_AFTER=$(chsql --query "SELECT count() FROM event_archive_compound_governor_bravo FINAL WHERE dao_source_id='$DAO_SOURCE_ID' AND block_number BETWEEN 25000000 AND 25001000")

echo "before=$COUNT_BEFORE after=$COUNT_AFTER"
# expected: equal
```

### 5) DLQ stage visibility

```bash
psql -c "
  SELECT stage, count(*)
  FROM ingestion_dlq
  WHERE accepted_at IS NULL AND resolved_at IS NULL
  GROUP BY stage
  ORDER BY stage
"

# grafana/prom panel backing query:
# sum by (event_type) (rate(chainMetrics_archiveWrites{result='dlq_routed'}[5m]))
```

---

## DLQ fault-injection drill

Run each scenario in its own shell subshell with cleanup trap.

### Scenario A — VoteCast PG failure -> `vote_archive_write`

```bash
(
  trap 'psql -c "GRANT INSERT ON archive_confirmation TO kvorum" || true' EXIT

  TARGET_BLOCK=<known_votecast_only_block>

  psql -c "REVOKE INSERT ON archive_confirmation FROM kvorum"

  admin-cli backfill start compound_governor_bravo \
    --from-block "$TARGET_BLOCK" \
    --to-block "$TARGET_BLOCK" \
    --confirm-replay \
    --format json

  psql -c "SELECT id, stage, first_seen_at FROM ingestion_dlq WHERE stage='vote_archive_write' ORDER BY first_seen_at DESC LIMIT 5"

  DLQ_ID=$(psql -Atc "SELECT id FROM ingestion_dlq WHERE stage='vote_archive_write' ORDER BY first_seen_at DESC LIMIT 1")

  psql -c "GRANT INSERT ON archive_confirmation TO kvorum"

  admin-cli dlq retry "$DLQ_ID" --format json

  psql -c "SELECT id, resolved_at FROM ingestion_dlq WHERE id='$DLQ_ID'"
)
```

### Scenario B — Proposal PG failure -> `archive_confirmation_write`

```bash
(
  trap 'psql -c "GRANT INSERT ON archive_confirmation TO kvorum" || true' EXIT

  TARGET_BLOCK=<known_proposal_event_block>

  psql -c "REVOKE INSERT ON archive_confirmation FROM kvorum"

  admin-cli backfill start compound_governor_bravo \
    --from-block "$TARGET_BLOCK" \
    --to-block "$TARGET_BLOCK" \
    --confirm-replay \
    --format json

  psql -c "SELECT id, stage, first_seen_at FROM ingestion_dlq WHERE stage='archive_confirmation_write' ORDER BY first_seen_at DESC LIMIT 5"
)
```

### Scenario C — CH outage -> governor DLQ routing

```bash
(
  trap 'docker compose start clickhouse || true' EXIT

  TARGET_BLOCK=<known_votecast_or_proposal_block>

  docker compose stop clickhouse

  admin-cli backfill start compound_governor_bravo \
    --from-block "$TARGET_BLOCK" \
    --to-block "$TARGET_BLOCK" \
    --confirm-replay \
    --format json || true

  docker compose start clickhouse

  psql -c "
    SELECT id, stage, first_seen_at
    FROM ingestion_dlq
    WHERE stage IN ('vote_archive_write','archive_confirmation_write')
    ORDER BY first_seen_at DESC
    LIMIT 10
  "
)
```

### Scenario D — comp-token failure -> `delegation_archive_write`

```bash
(
  trap 'psql -c "GRANT INSERT ON archive_confirmation TO kvorum" || true' EXIT

  TARGET_BLOCK=<known_comp_token_event_block>

  psql -c "REVOKE INSERT ON archive_confirmation FROM kvorum"

  admin-cli backfill start compound_comp_token \
    --from-block "$TARGET_BLOCK" \
    --to-block "$TARGET_BLOCK" \
    --confirm-replay \
    --format json

  psql -c "SELECT id, stage, first_seen_at FROM ingestion_dlq WHERE stage='delegation_archive_write' ORDER BY first_seen_at DESC LIMIT 5"

  DLQ_ID=$(psql -Atc "SELECT id FROM ingestion_dlq WHERE stage='delegation_archive_write' ORDER BY first_seen_at DESC LIMIT 1")

  psql -c "GRANT INSERT ON archive_confirmation TO kvorum"

  admin-cli dlq retry "$DLQ_ID" --format json
)
```

---

## Run results

| Metric                             | Value |
| ---------------------------------- | ----- |
| Alpha runtime                      |       |
| Bravo runtime                      |       |
| OZ runtime                         |       |
| Comp-token runtime                 |       |
| Calibration adjustment needed      |       |
| Total unresolved DLQ after cleanup |       |
| Gate #1 aggregate                  |       |
| Gate #2 proposal sample            |       |
| Gate #3 comp-token totals          |       |
| Gate #4 idempotency                |       |

---

## Follow-ups

- Open rehearsal results issue and link this filled runbook.
- Open follow-up for `infra/scripts/collect-backfill-results.sh` generalization across M2 sources.
