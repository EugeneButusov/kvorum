# Architecture Decision Records

Post-freeze decisions amending Kvorum's v1.0 specification. Each ADR documents context, decision, alternatives, and consequences for a single design choice. The spec at `docs/SPEC.md` is the v1.0 baseline; reading the spec plus the ADRs in order yields the current canonical design.

See SPEC §8.4 for the ADR process. Numbering continues from the v1.0 DRs (DR-001 through DR-020), so the first post-freeze ADR is ADR-021.

## Index

| ADR                                             | Title                                                     | Status   | Spec sections   |
| ----------------------------------------------- | --------------------------------------------------------- | -------- | --------------- |
| [ADR-021](0021-vote-supersession.md)            | Vote supersession model for Snapshot vote changes         | Proposed | 2.4.7, 2.8, 4.2 |
| [ADR-022](0022-voting-power-block-snapshot.md)  | `voting_power_block` populated for Snapshot proposals     | Proposed | 2.4.4, 3.6      |
| [ADR-023](0023-primary-choice-scope.md)         | `primary_choice` scoped to single-choice voting types     | Proposed | 2.4.7           |
| [ADR-024](0024-dual-governance-history.md)      | `dual_governance_state` modeled as DAO-wide history       | Proposed | 2.5             |
| [ADR-025](0025-credential-hashing.md)           | API key hashing uses HMAC-SHA256; passwords use argon2id  | Proposed | 4.3, 7.6        |
| [ADR-026](0026-defer-clickhouse.md)             | Defer ClickHouse to v1.x; v1 uses Postgres only           | Proposed | 2.7, 7.1        |
| [ADR-027](0027-backfill-confirmation-cutoff.md) | Backfill confirmation cutoff rule                         | Proposed | 3.10            |
| [ADR-028](0028-secrets-vault.md)                | Off-host secrets vault for production credentials         | Proposed | 7.5, 7.6        |
| [ADR-029](0029-license.md)                      | Code license: AGPL-3.0 (existing LICENSE file)            | Accepted | 1.6             |
| [ADR-030](0030-title-extraction.md)             | Per-source title extraction rules                         | Proposed | 2.4.4           |
| [ADR-031](0031-vetoed-state-scope.md)           | `vetoed` state scoped to Lido Dual Governance in v1       | Proposed | 2.4.4           |
| [ADR-032](0032-dlq-accept-semantics.md)         | DLQ `accept` is permanent acknowledgement, not retry      | Proposed | 6.20.1          |
| [ADR-033](0033-actor-merge-redirects.md)        | Actor merge produces HTTP 301 redirects on canonical URLs | Proposed | 2.4.3, 4.2      |
| [ADR-034](0034-forum-content-pipeline.md)       | Forum content pipeline: HTML → Markdown via turndown      | Proposed | 3.7             |
| [ADR-035](0035-adaptive-polling.md)             | Dashboard polling adapts to remaining rate-limit quota    | Proposed | 4.4, 6.16       |

## Status legend

- **Proposed** — under consideration; not yet implemented.
- **Accepted** — agreed upon and reflected in the system.
- **Superseded by ADR-NNN** — replaced by a later decision; preserved for historical context.
- **Deprecated** — no longer relevant; not implemented.
