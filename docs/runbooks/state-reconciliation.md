# State Reconciliation Runbook (Issue #133)

This runbook covers operation and validation of the indexer state reconciler for event-silent governor transitions (`defeated`, `expired`, `active` corrections).

## Scope

- Source type: `compound_governor_bravo` (reconcilable = true)
- Explicitly excluded: `compound_governor_alpha` (reconcilable = false, ADR-048)
- Reconciler writes only event-silent states.

## Prerequisites

1. Migrations from PR 2 are applied:

- `proposal.timelock_eta`
- `proposal.last_reconcile_check_block`
- `source_type.reconcilable`

2. Compound source migration sets `compound_governor_bravo.reconcilable = true`.
3. Indexer is deployed with `StateReconcilerService`.
4. RPC provider can serve:

- `eth_getBlockByNumber` for old historical blocks
- `eth_call state(uint256)` at confirmed-threshold block tags.

## Configuration

- `STATE_RECONCILE_BATCH_SIZE` (default `50`)
- `STATE_RECONCILE_RECHECK_GAP_BLOCKS` (default `7200`)
- `STATE_RECONCILE_RPC_FAIL_ESCALATE` (default `5`)
- `GOVERNOR_GRACE_PERIOD_SECONDS` (optional fallback)
- `GOVERNOR_GRACE_MIN_SECONDS` (default `3600`)
- `GOVERNOR_GRACE_MAX_SECONDS` (default `7776000`)

Tick cadence reuses `sweepIntervalMs ?? SWEEP_INTERVAL_MS`.

## Deployment checks

1. Boot indexer and confirm no startup errors from `StateReconcilerService`.
2. Confirm source flag:

```sql
SELECT value, reconcilable
FROM source_type
WHERE value IN ('compound_governor_bravo', 'compound_governor_alpha');
```

Expected:

- bravo: `true`
- alpha: `false`

3. Confirm backlog visibility:

```sql
SELECT count(*)
FROM proposal p
JOIN dao d ON d.id = p.dao_id
JOIN source_type st ON st.value = p.source_type
WHERE st.reconcilable = true
  AND p.state IN ('pending','active','succeeded','queued');
```

## First-run backlog drain expectations

- Rows without `last_reconcile_check_block` are eligible immediately.
- Batch drains in `STATE_RECONCILE_BATCH_SIZE` chunks.
- Long-lived non-transition rows are rotated by watermark and do not starve newly-eligible rows.

Check watermark progress:

```sql
SELECT
  count(*) FILTER (WHERE last_reconcile_check_block IS NULL) AS unchecked,
  count(*) FILTER (WHERE last_reconcile_check_block IS NOT NULL) AS checked
FROM proposal p
JOIN source_type st ON st.value = p.source_type
WHERE st.reconcilable = true
  AND p.state IN ('pending','active','succeeded','queued');
```

## Acceptance verification

### 1) Known stale rows corrected by reconciler (no manual SQL)

```sql
SELECT source_id, state, state_updated_at
FROM proposal
WHERE source_type = 'compound_governor_bravo'
  AND source_id IN ('166','257');
```

Expected: no longer stale `pending`; values match on-chain lifecycle.

### 2) No lingering past-deadline rows beyond normal reconciliation window

```sql
SELECT count(*)
FROM proposal p
JOIN dao d ON d.id = p.dao_id
WHERE p.source_type = 'compound_governor_bravo'
  AND p.state IN ('pending','active','succeeded','queued')
  AND p.voting_ends_block IS NOT NULL
  AND p.voting_ends_block::bigint < 0; -- replace 0 with current confirmed threshold
```

Expected after steady-state: near-zero and decreasing.

### 3) Missed authoritative events are surfaced, not silently overwritten

Watch logs/metrics for `state_reconcile_missed_event` (on-chain `executed|queued|canceled` while local non-terminal).

## Troubleshooting

### Repeated `rpc_failed`

- Symptom: `state_reconcile_rpc_failed` with streak growth and escalations.
- Action:

1. Validate RPC health and quota.
2. Verify historical header availability.
3. Reduce `STATE_RECONCILE_BATCH_SIZE` temporarily.

### `expired_no_eta`

- Means legacy queued row has NULL `timelock_eta`.
- Reconciler intentionally skips write and logs outcome.
- Backfill/re-derivation of queued event data is required before expiry timestamp can be authored.

### GRACE_PERIOD issues

- If on-chain read fails or value is invalid range:

1. Set `GOVERNOR_GRACE_PERIOD_SECONDS` to validated value.
2. Restart indexer.

## Optional manual SQL escape hatch

Manual correction SQL is emergency-only and must be recorded in incident notes. Normal path is reconciler + backfill/event re-derivation.
