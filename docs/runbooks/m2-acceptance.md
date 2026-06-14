# M2 Acceptance Runbook

## Scope

This runbook covers M2 acceptance execution for the O3 analytical endpoints. The voting-power snapshot feature was retired in M3 V3 (#262); snapshot drain and `voting_power_snapshot_run` SQL checks are no longer applicable.

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
FROM delegation_flow_projection FINAL
WHERE dao_id = '<compound-dao-id>'
ORDER BY voting_power ASC;
```

3. Compare endpoint `gini` value against an independent calculator (e.g. Wolfram `Gini[{...}]`).
4. Accept if absolute difference <= 0.001.
