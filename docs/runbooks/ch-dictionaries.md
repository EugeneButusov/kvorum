# ClickHouse dictionaries — operator runbook

`actor_address_redirect` is a ClickHouse dictionary whose source is a **live Postgres connection**.
ClickHouse opens that connection itself, so its DDL embeds a host and credentials that differ in
every environment. That makes it per-environment configuration rather than versioned schema, and it
is applied by an operator — not by the migration Job.

Everything else in ClickHouse is a migration (`pnpm -w db:migrate:ch`). This dictionary is the
exception; see the header comment in `libs/db/src/ch-dictionaries.ts` for the full reasoning.

## When to run

Run `pnpm -w db:ch:dictionaries` when:

1. **Provisioning a new environment** — after `db:migrate:ch`, before the API serves traffic.
2. **The CH→PG route changes** — Postgres host moved, or its credentials were rotated
   (see [secrets-rotation.md](secrets-rotation.md)).
3. **Diagnosing 500s on the delegation analytics endpoints** — see "Symptoms" below.

It is **not** part of the deploy. A normal code deploy does not need it; the dictionary persists in
ClickHouse once created.

## Symptoms of a dictionary that never loaded

`GET /v1/daos/<slug>/analytics/delegation-flow` and `.../analytics/delegates` return **500** while
`.../analytics/concentration` returns **200**. That exact split is the tell: concentration is the one
delegation endpoint that touches no dictionary. Every `dictGetOrNull()` throws when the dictionary
is not `LOADED`, so the endpoints that resolve actor ids fail and the one that doesn't survives.

The DAO health page swallows the delegation-flow error and renders "No delegation relationships
recorded" next to a concentration chart reporting a large delegate count — so the UI looks merely
empty rather than broken.

Confirm before acting:

```sql
SELECT name, status, last_exception FROM system.dictionaries WHERE name = 'actor_address_redirect';
```

`status` must be `LOADED`. `FAILED` with a connection error in `last_exception` means the route is
wrong or unauthorized.

## Prerequisites (production)

ClickHouse must be able to reach Postgres **on its own**, which is not the same path the app uses:

- **Use the public Postgres host.** A DigitalOcean managed ClickHouse sits outside the cluster VPC,
  so the VPC/private host is unreachable from it. This is _not_ `DATABASE_URL` — deriving it from
  `DATABASE_URL` points ClickHouse at the wrong address (locally that would be `localhost`, i.e.
  ClickHouse itself).
- **Add the ClickHouse egress IP to the managed Postgres trusted sources.** Without it Postgres
  refuses the connection and the dictionary loads `FAILED`.

## How to run

From a checkout, with the target environment's ClickHouse and the CH→PG route in the env. The
`CH_DICT_PG_*` values are the ones ClickHouse itself will dial; they are deliberately not stored in
`kvorum-secrets`, because nothing in the running cluster consumes them.

```bash
# ClickHouse to apply the dictionary to
export CLICKHOUSE_URL='https://...:8443'
export CLICKHOUSE_USER='...'
export CLICKHOUSE_PASSWORD='...'
export CLICKHOUSE_DATABASE='kvorum'

# The Postgres route ClickHouse uses to load the dictionary — public host, see Prerequisites
export CH_DICT_PG_HOST='<public-pg-host>'
export CH_DICT_PG_PORT='25060'
export CH_DICT_PG_USER='...'
export CH_DICT_PG_PASSWORD='...'
export CH_DICT_PG_DB='kvorum'

pnpm -w db:ch:dictionaries
```

Locally, no env is needed at all — the defaults are the docker-compose topology
(`postgres:5432`), which is what compose ClickHouse can resolve:

```bash
pnpm -w db:ch:dictionaries
```

The script issues `CREATE OR REPLACE`, so re-running it with a **correct** route is always safe.

> **Check the route before running this against a live environment.** `CREATE OR REPLACE` replaces
> the dictionary before the load is verified, so applying a wrong host or credential leaves the
> dictionary `FAILED` — taking down analytics endpoints that were working until you ran it. The
> script exits non-zero when that happens, but it does not roll back. Recover by re-running with the
> correct route; nothing else is needed, since the dictionary holds no state of its own.

## Verifying

Success reloads the dictionary and asserts it actually loaded — the password is never logged:

```
[ch-dictionaries] actor_address_redirect → postgres kvorum@postgres:5432/kvorum
[ch-dictionaries] actor_address_redirect LOADED
```

A bad route exits non-zero rather than leaving a dictionary that throws on every read:

```
[ch-dictionaries] Try 2. Connection to `unreachable-host.invalid:5432` failed with error:
  could not translate host name "unreachable-host.invalid" to address: Name or service not known
```

Then re-check the analytics endpoints — `delegation-flow` and `delegates` should return 200.

## Reference

- `libs/db/src/ch-dictionaries.ts` — DDL builder and why this is not a migration
- `libs/db/scripts/apply-ch-dictionaries.mts` — the script this runbook drives
- ADR-0033 (actor merge redirects) — the redirect semantics the dictionary encodes
- ADR-0062 (CH as source of truth) — the PG/CH boundary
