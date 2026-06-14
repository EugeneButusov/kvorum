# ADR-026 — Defer ClickHouse to v1.x; v1 uses Postgres only

- **Status**: Superseded by [ADR-038](0038-clickhouse-archive-layer-in-m1.md)
- **Date**: 2026-05-08
- **Spec sections affected**: 2.7, 7.1
- **Related**: DR-014, ADR-038 (supersedes)

> **Superseded note (2026-05-10):** ADR-038 splits the original blanket deferral into two layers — the **raw event archive layer** ships in M1 on ClickHouse; the **analytical mirror layer** (`vote_events_projection`, `delegation_flow_projection`) remains deferred per this ADR's activation triggers. The activation-trigger language below is preserved verbatim by ADR-038 and continues to apply to the analytical mirror layer only. **Further superseded 2026-05-28 by ADR-0062** — ClickHouse is now source of truth for chain-event-derived data (`vote_events_projection`, `delegation_flow_projection`; `voting_power_snapshot_projection` retired M3 V3 #262); it is no longer deferred.

## Context

SPEC §7.1 specifies a single Hetzner CX32 (4 vCPU, 8 GB RAM) hosting Postgres 16 + ClickHouse + Redis 7 + 6 Kvorum services + Grafana + Prometheus + Loki + Alertmanager + Caddy + Uptime Kuma. SPEC §2.7 already concedes that "for v1 with three DAOs, ClickHouse is technically optional — the analytical queries run acceptably on Postgres."

Running 14 containers including two databases and a monitoring stack on 8 GB RAM is achievable but tight. ClickHouse alone wants 2–4 GB to behave well under load. The combined working set leaves no headroom for spikes (backfill, AI batch cycles, occasional analytical queries on large windows).

Three responses are reasonable:

1. Upgrade to CX42 (€20/month vs €10) — doubles host cost but keeps the architecture.
2. Move ClickHouse to a managed service — adds vendor and ongoing cost.
3. Defer ClickHouse activation; ship v1 on Postgres only.

§2.7 already approves option 3 in its language. This ADR makes that explicit and defines the activation trigger.

## Decision

v1 ships without ClickHouse. The analytical endpoints in §4.6.2 are implemented against Postgres with appropriate indexes and one or two materialized views (refreshed on a cron schedule appropriate to the metric — concentration daily, delegation flow hourly).

The ClickHouse table designs in §2.7 (`voting_power_history_projection`, `vote_events_projection`, `delegation_flow_projection`) remain documented as the v1.x activation path. No mirror writes are implemented in v1; when ClickHouse is activated, the initial population is an offline backfill from Postgres.

**Activation triggers** (ClickHouse moves from deferred to deployed when _any_ of these is true):

- Any committed analytical endpoint exceeds p99 5 s sustained for 10 minutes (§7.2's stated p99).
- A fourth DAO is added to v1.x scope.
- Indexed Postgres rows in the `vote_events_projection`-equivalent denormalized view exceed ~5 M rows.

Activation is a v1.x release, not an ADR — when triggered, the deployment runbook walks through provisioning, backfill, and cutover. The CX42 upgrade is bundled with activation.

## Alternatives considered

- **Upgrade to CX42 at v1 launch and ship ClickHouse.** Defensible and within the €60 ceiling. Eats half the cost headroom for a system that §2.7 already acknowledges Postgres can serve. The upgrade is cheap and reversible — preferred to defer until the load demands it.
- **Use a managed ClickHouse (Aiven, ClickHouse Cloud).** Adds €20–40/month minimum; introduces a vendor with its own auth and network configuration. Premature for v1 scale.
- **Ship ClickHouse on CX32 anyway.** Real risk of OOM during AI batch cycles or backfill. The spec's own §2.7 language gives permission to defer; doing so is the sensible call.

## Consequences

- §7.1's service inventory loses ClickHouse for v1; the deployment is 11 containers instead of 14, comfortable on CX32 with headroom.
- §4.6.2 analytical endpoints meet the §7.2 latency targets on Postgres at v1 scale, per §2.7's explicit acknowledgment.
- The v1 cost ceiling holds without strain: CX32 (€10) plus everything else stays well under €60.
- A new known concern is added to §9 to track the deferral and its triggers:

> **KNOWN-026 — ClickHouse deployment deferred to v1.x**
> _Severity: minor. Category: operational._
> _Description: v1 ships without ClickHouse; analytical endpoints run against Postgres. The ClickHouse table designs in §2.7 remain documented as the v1.x activation path._
> _Resolution: activate ClickHouse when any of the triggers in ADR-026 fires._

(KNOWN registry numbering: the next available ID is KNOWN-024 since v1.0 ends at KNOWN-023. ADR-029, ADR-026, and any other ADR introducing a deferral allocate KNOWN IDs in ADR-acceptance order.)
