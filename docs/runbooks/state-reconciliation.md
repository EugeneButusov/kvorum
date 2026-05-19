# State Reconciliation Runbook (Issue #133)

This runbook covers operation and validation of the indexer state reconciler for event-silent governor transitions (`defeated`, `expired`, `active` corrections).

## Scope

- Source type: `compound_governor_bravo` (reconciler plugin enabled)
- Explicitly excluded: `compound_governor_alpha` (no reconciler plugin, ADR-048)
- Reconciler writes only event-silent states.

## Prerequisites

1. Migration `compound_001_schema` is applied. It creates:

- `compound_proposal_meta.queued_at_block` — populated by the applier on `ProposalQueued` events; used by the reconciler to timestamp `expired` transitions
- `compound_proposal_meta.last_reconcile_check_block` — watermark updated on every reconcile check

2. Indexer is deployed with `CompoundReconcileService` and source reconciler plugins.
3. RPC provider can serve:

- `eth_getBlockByNumber` for old historical blocks (timestamp lookup)
- `eth_call state(uint256)` at confirmed-threshold block tags
- `eth_call timelock()`, `GRACE_PERIOD()`, `delay()` at confirmed-threshold block tags (for `expired` transitions)

## Configuration

| Env var                                        | Default     | Notes                                                                                                                |
| ---------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `COMPOUND_STATE_RECONCILE_BATCH_SIZE`          | `50`        | proposals processed per confirmed-head tick                                                                          |
| `COMPOUND_STATE_RECONCILE_RECHECK_GAP_SECONDS` | `7200` (2h) | minimum wall-clock time between rechecks of the same proposal; converted to blocks per chain using `blocksPerMinute` |
| `COMPOUND_STATE_RECONCILE_RPC_FAIL_ESCALATE`   | `5`         | consecutive RPC failures before escalation log                                                                       |
| `COMPOUND_GOVERNOR_GRACE_MIN_SECONDS`          | `3600`      | sanity floor for on-chain `GRACE_PERIOD()` reads                                                                     |
| `COMPOUND_GOVERNOR_GRACE_MAX_SECONDS`          | `7776000`   | sanity ceiling (~90 days)                                                                                            |

**Chain config** (`CHAIN_CONFIG` JSON): set `blocksPerMinute` per chain to ensure the gap converts correctly (default `5` = Ethereum mainnet ~12s/block; Optimism/Base ≈ `30`; Arbitrum ≈ `240`).

Tick cadence: driven by the head tracker — one reconcile attempt per confirmed head, gated by the `inFlight` guard to prevent overlap.

## Deployment checks

1. Boot indexer and confirm no startup errors from `CompoundReconcileService`.
2. Confirm source types are seeded:

```sql
SELECT value
FROM source_type
WHERE value IN ('compound_governor_bravo', 'compound_governor_alpha');
```

Expected: both rows exist.

3. Confirm backlog visibility:

```sql
SELECT count(*)
FROM proposal p
JOIN dao d ON d.id = p.dao_id
WHERE p.source_type = 'compound_governor_bravo'
  AND p.state IN ('pending','active','succeeded','queued');
```

## First-run backlog drain expectations

- Rows without a `compound_proposal_meta` entry (or with `last_reconcile_check_block IS NULL`) are eligible immediately.
- Batch drains in `COMPOUND_STATE_RECONCILE_BATCH_SIZE` chunks per tick.
- The recheck gap prevents already-checked rows from re-entering the batch until the confirmed head has advanced by `ceil(recheckGapSeconds / 60 * blocksPerMinute)` blocks.

Check watermark progress:

```sql
SELECT
  count(*) FILTER (WHERE m.last_reconcile_check_block IS NULL) AS unchecked,
  count(*) FILTER (WHERE m.last_reconcile_check_block IS NOT NULL) AS checked
FROM proposal p
LEFT JOIN compound_proposal_meta m ON m.proposal_id = p.id
WHERE p.source_type = 'compound_governor_bravo'
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
2. Verify historical header availability (`eth_getBlockByNumber` for blocks near `voting_ends_block`).
3. Reduce `COMPOUND_STATE_RECONCILE_BATCH_SIZE` temporarily.

### `expired_no_queued_at_block`

- Means a `queued` proposal has no entry in `compound_proposal_meta.queued_at_block`.
- This happens for proposals queued before the indexer was deployed (no `ProposalQueued` event was processed).
- Reconciler intentionally skips write and logs outcome.
- Backfill/re-derivation of the `ProposalQueued` event is required before the `expired` timestamp can be authored.

### Grace period / delay out of range

- Symptom: `resolveTimelockParams` returns null; reconciler emits `expired_no_queued_at_block`.
- Cause: on-chain `GRACE_PERIOD()` or `delay()` falls outside `[COMPOUND_GOVERNOR_GRACE_MIN_SECONDS, COMPOUND_GOVERNOR_GRACE_MAX_SECONDS]`.
- Action: adjust the env var bounds to match the deployed timelock and restart the indexer.

## Optional manual SQL escape hatch

Manual correction SQL is emergency-only and must be recorded in incident notes. Normal path is reconciler + backfill/event re-derivation.
