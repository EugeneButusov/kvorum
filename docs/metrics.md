# Metrics Inventory (M1)

This document is the authoritative metric enumeration for M1, based on emitted instrument names in code.

| Name / family                                                                                                   | Type                         | Labels (primary)                                               | Unit                              | Emitting service(s)             | M1 status     |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------- | --------------------------------- | ------------------------------- | ------------- |
| `api_requests_total`                                                                                            | counter                      | `method`, `route`, `status`                                    | requests                          | `apps/api`                      | emitted       |
| `api_latency_seconds` (`_bucket`, `_sum`, `_count`)                                                             | histogram                    | `method`, `route`, `status`                                    | seconds                           | `apps/api`                      | emitted       |
| `auth_*` (`auth_pepper_match_total`, `auth_rejections_total`)                                                   | counters                     | `pepper` / `reason`                                            | requests                          | `apps/api`                      | emitted       |
| `rate_limit_rejections_total`                                                                                   | counter                      | `tier`, `reason`                                               | requests                          | `apps/api`                      | emitted       |
| `ingestion_*`                                                                                                   | counters, gauges, histograms | `chain`, `source`, `dao_source`, provider labels, stage labels | mixed (seconds, blocks, counts)   | `libs/chain` via `apps/indexer` | emitted       |
| `archive_*` (`archive_skipped_existence_total`, `archive_ch_write_errors_total`, `archive_decode_errors_total`) | counters                     | `source`, reason labels                                        | events                            | `libs/chain` via `apps/indexer` | emitted       |
| `dual_write_pg_unreachable_total`                                                                               | counter                      | `source`                                                       | events                            | `libs/chain` via `apps/indexer` | emitted       |
| `indexer_active_sources`                                                                                        | gauge                        | `source_type`                                                  | count                             | `libs/chain` via `apps/indexer` | emitted       |
| `derivation_*`                                                                                                  | counters, gauges, histograms | `source`, `outcome`, `event_type`, reason labels               | mixed (seconds, counts, fraction) | `apps/indexer`                  | emitted       |
| `db_*`                                                                                                          | TBD                          | TBD                                                            | TBD                               | TBD                             | planned (M2+) |
| `ai_*`                                                                                                          | TBD                          | TBD                                                            | TBD                               | `apps/ai-worker` (future)       | planned (M5)  |

## Source of truth

Declared metrics are defined in:

- `apps/api/src/observability/api-metrics.ts`
- `libs/chain/src/metrics/metrics.ts`
- `apps/indexer/src/derivation/derivation-metrics.ts`
- `apps/indexer/src/derivation/calldata-decode-metrics.ts`

Notes:

- Counter names are declared without `_total`; Prometheus exposition appends `_total`.
- `ingestion_dlq_size` is emitted under the `ingestion_*` family (not a separate emitted `dlq_*` family in M1).
