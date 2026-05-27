# M2 Acceptance Runbook

## Scope

This runbook covers M2 acceptance execution for Compound vote and voting-power snapshot delivery, with emphasis on the L3 snapshot worker path.

## Pre-flight checks

Run these checks before snapshot drain:

```sql
-- Expect at least 4 rows (3 governor sources + 1 COMP token source)
SELECT count(*)
FROM dao_source
WHERE source_type IN (
  'compound_governor_alpha',
  'compound_governor_bravo',
  'compound_governor_oz',
  'compound_comp_token'
);
```

```bash
admin-cli chain peek --chain-id 0x1 --method eth_blockNumber
admin-cli dlq list
```

Expected:

- Chain RPC check returns a current block number.
- No unresolved DLQ rows for snapshot/projection/archive stages before acceptance starts.

## Snapshot drain procedure

1. Stop the indexer process so no scheduled snapshot tick competes with CLI drain.

```bash
systemctl stop kvorum-indexer
# or local equivalent
```

2. Run a foreground snapshot drain.

```bash
admin-cli snapshot drain
```

3. Observe progress lines:

- `processed N proposals so far, current=<proposal_id>, outcome=<...>`
- Completion line: `snapshot drain completed; processed=<N>, dlq=<true|false>`

4. Exit code handling:

- `0`: drain completed and no proposal was routed to DLQ.
- `1`: at least one proposal routed to `snapshot_compute_stage` DLQ.
- `2`: advisory lock not acquired (`another snapshot drain or indexer tick holds the lock`).

5. If exit code is `1`, inspect and retry DLQ rows:

```bash
admin-cli dlq list --feature indexer.snapshot
admin-cli dlq retry <dlq_id>
```

The `dlq retry` command is stage-aware in M2 and supports:

- `vote_projection_stage`
- `delegation_projection_stage`
- `snapshot_compute_stage`
- archive retry stages

## Runtime expectations

Typical runtime envelope for full historical snapshot drain:

- Warm path (sample verify only): tens of minutes.
- With fallback engagement (rare): can extend toward multi-hour windows due to large per-proposal RPC volume.

## Acceptance sanity queries

### AC #1: Snapshot rows exist for all eligible Compound proposals

```sql
SELECT
  p.source_type,
  count(*) AS proposals,
  count(vpsr.proposal_id) FILTER (WHERE vpsr.status = 'completed') AS completed_runs
FROM proposal p
LEFT JOIN voting_power_snapshot_run vpsr ON vpsr.proposal_id = p.id
WHERE p.source_type IN (
  'compound_governor_alpha',
  'compound_governor_bravo',
  'compound_governor_oz'
)
AND p.state IN ('active','succeeded','defeated','queued','executed','expired','vetoed')
GROUP BY p.source_type
ORDER BY p.source_type;
```

```sql
SELECT count(*) AS missing_snapshot_rows
FROM proposal p
LEFT JOIN voting_power_snapshot s ON s.proposal_id = p.id
WHERE p.source_type IN (
  'compound_governor_alpha',
  'compound_governor_bravo',
  'compound_governor_oz'
)
AND p.state IN ('active','succeeded','defeated','queued','executed','expired','vetoed')
GROUP BY p.id
HAVING count(s.id) = 0;
```

Expected: no proposals missing snapshot rows.

### AC #2: Zero unresolved mismatches after fallback

```sql
SELECT
  count(*) FILTER (WHERE status = 'failed') AS failed_runs,
  count(*) FILTER (WHERE fallback_engaged = true AND status = 'completed') AS completed_with_fallback
FROM voting_power_snapshot_run;
```

Expected:

- `failed_runs = 0`
- Completed fallback rows are acceptable; they indicate mismatch recovery succeeded.

## Notes

- AC #3 (fallback path exercised) is verified by integration tests in M2; no production fault injection is required in acceptance operations.
- Snapshot retry semantics are crash-safe: retries re-enter from `in_progress` and recompute proposal rows from scratch.

## O3 analytical endpoints

### Performance gate

Seed mirror data first, then run:

```bash
API_KEY=<m2-api-key> pnpm --filter api script:autocannon-analytics
```

Acceptance thresholds:

- `proposal-pass-rate` p95 < 500ms
- `concentration`, `delegation-flow`, `delegate-alignment`, `cross-dao` p99 < 5s

If a threshold breaches, profile the CH query and reduce response shape pressure before widening infra.

### AC #4 Gini cross-check

1. Pick a Compound DAO/time bucket used for release acceptance.
2. Pull weights from CH:

```sql
SELECT voting_power
FROM delegation_flow_flat FINAL
WHERE dao_id = '<compound-dao-id>'
ORDER BY voting_power ASC;
```

3. Compare endpoint `gini` value against an independent calculator (e.g. Wolfram `Gini[{...}]`).
4. Accept if absolute difference <= 0.001.
