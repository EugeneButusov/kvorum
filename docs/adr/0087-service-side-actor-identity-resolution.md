# ADR-087 — Resolve actor identity in the service, not inside ClickHouse

- **Status**: Accepted
- **Date**: 2026-07-16
- **Spec sections affected**: 6.7 (DAO health), 6.9 (delegate scorecard), 6.12 (actor page)
- **Related**: ADR-033 (actor merge redirects), ADR-041 (cross-DB integrity contract), ADR-062 (CH source-of-truth boundary), PR #550 (closed)

## Context

ClickHouse analytics need to answer "which actor owns this address?" — to sum a merged actor's voting
power into one leaderboard row, to group peers on the alignment page, to label delegation-flow edges.
Today it answers that with the `actor_address_redirect` **dictionary**, whose `SOURCE` is a live
PostgreSQL connection opened by ClickHouse itself.

That design has produced one outage and three latent defects.

**1. It is broken in production right now.** The dictionary's DDL (CH migration `0001`, credentials
patched by `0006`) hardcodes the docker-compose topology — `HOST 'postgres'`. No managed ClickHouse
can resolve that name, so the dictionary never loads and **every `dictGetOrNull()` throws**. The
symptom is diagnostic: `analytics/delegation-flow` and `analytics/delegates` return 500 while
`analytics/concentration` returns 200 — concentration is the one delegation endpoint that touches no
dictionary. It works locally only because compose ClickHouse _can_ reach the `postgres` service,
which is why it never appeared in dev or CI.

**2. The rule is duplicated and has drifted.** Address→actor resolution is written in
`libs/db/src/actor-routing-repository.ts:60` as `coalesce(aa.actor_id, a.id, aar.to_actor_id)` —
three arms — and in the CH dictionary as two arms, with no `actor.primary_address` fallback. The two
disagree for any actor whose `primary_address` lacks an `actor_address` row.

**3. It is stale by construction.** `LIFETIME(MIN 30 MAX 90)` means CH identity lags PG by up to 90
seconds. Requests that mix _fresh_ PG identity with _stale_ dictionary identity are wrong in that
window: `crossDaoSummaryForActor` (`analytics-read-repository.ts:388`) reads an actor's addresses
live from PG but groups by the stale dictionary, so for up to 90s after a merge the API returns
**duplicate DAO entries** for one actor, splitting its `votes_cast` and `last_active_at`. Unlike the
outage, this fails silently and self-heals.

**4. It couples the databases at the network layer.** ClickHouse must hold Postgres credentials and
reach Postgres on a route that is not `DATABASE_URL` (locally the app reaches PG on `localhost`
while ClickHouse must use `postgres`; a managed ClickHouse reaches it somewhere else again). In
production this requires the _public_ Postgres host plus ClickHouse's egress IP in the managed
Postgres trusted sources — an operational burden that exists solely to serve this dictionary.

### Two findings that reframe the problem

**The dictionary is `actor_address` with a dead branch.** Its source query unions `actor_address`
with unshadowed rows from `actor_address_redirect`. That second branch can never match:
`executeMerge` (`actor-merge-repository.ts:239`) retargets _all_ of the secondary's `actor_address`
rows to the survivor, then (`:262`) inserts a redirect whose `from_address` **is** the secondary's
primary address — which is therefore always present in `actor_address`, so the `NOT EXISTS` always
excludes it. Both branches would return the survivor id regardless. The dictionary is equivalent to
`SELECT address, actor_id FROM actor_address`.

**Address→actor is a bijection, except for merged actors.** There is exactly one production writer of
`actor_address`: `findOrCreateActorAddress` (`actor-repository.ts:103`), which creates one actor and
one address together, 1:1. `actors address add` is an unimplemented stub
(`apps/admin-cli/src/commands/actor.ts:132`). The only way an actor acquires a second address is
`executeMerge`'s retarget UPDATE. So the entire dictionary — the network coupling, the credentials,
the staleness, the outage — exists to serve **a rare admin operation**. For every unmerged address,
`dictGetOrNull` is an identity function.

This is why the obvious objection to app-side resolution does not hold. Two of the six queries
(`delegateLeaderboard`, `delegateAlignmentPage`) rank a **top-N over an aggregate grouped by actor**,
so a merged actor's addresses must be summed _before_ the LIMIT cut — top-N-by-address is not
top-N-by-actor. That is true in general, but the addresses where it matters are exactly the merged
ones, and the service knows that set.

## Decision

**Delete the PG-sourced dictionary. Resolve actor identity in the service, and pass the small merge
map into ClickHouse as query data.**

For the two queries that must aggregate by actor:

1. **PG** — read the merge map: addresses belonging to multi-address (i.e. merged) actors, with their
   survivor's canonical address. Small, and cacheable per request.
2. **CH** — group on the canonical address, collapsing merged addresses with an inline `transform`:

   ```sql
   GROUP BY transform(toString(delegate_address),
                      ['0xmerged…'],      -- from PG, step 1
                      ['0xsurvivor…'],
                      toString(delegate_address)) AS canonical
   ORDER BY sum(vp) DESC, canonical ASC
   LIMIT N
   ```

   The aggregate, the ranking, and the top-N cut all stay inside ClickHouse.

3. **PG** — map the N returned canonical addresses → actor ids. Bounded by page size.

For the remaining four queries, resolve in the app layer with the existing
`ActorRoutingReadRepository.findCurrentActorIdsByAddresses` (`actor-routing-repository.ts:50`), which
is already written and integration-tested but has **no production call site**:

| Method                          | Role of resolved id                                | Change                                                   |
| ------------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| `delegationFlowEdges`           | projection only                                    | resolve returned rows in the app                         |
| `currentVotingPowerByActor`     | GROUP BY + WHERE                                   | group by address; fold `argMax` per actor in TS          |
| `crossDaoSummaryForActor`       | GROUP BY (redundant — already filtered by address) | drop the `dictGet`; `voter_actor_id` is a known constant |
| `alignmentWithMajorityForActor` | WHERE only                                         | filter `voter_address IN (…)`                            |

ClickHouse never opens a connection to Postgres. The `actor_address_redirect` dictionary is dropped.

## Consequences

### Positive

- **Fixes the production outage** and removes its whole bug class: no dictionary, no `dictGetOrNull`,
  nothing to fail to load.
- **Fixes the staleness bug rather than narrowing it.** The merge map is read from PG per request, so
  there is no window in which CH and PG disagree. The duplicate-DAO-row defect in
  `crossDaoSummaryForActor` disappears by construction.
- **One definition, in one place** — a service-side resolver. No DDL carrying a copy of the rule, no
  drift.
- **No CH→PG credentials, no trusted-sources/egress-IP setup, no per-environment deploy step.** This
  is the operational burden PR #550 was built to manage; it stops existing.
- **The queries get faster.** `dictGetOrNull(...) = ?` is not sargable: it defeats the
  `(dao_id, delegator_address, …)` sort key and the `bf_voter_address` / `bf_delegate_address` bloom
  filters, forcing a full partition scan. `transform(address, …)` groups on the sort-key column, and
  the rewritten filters become `voter_address IN (…)`.
- **Rejects a much larger alternative.** Dual-writing identity into a CH `ReplacingMergeTree` would
  invert ADR-041's CH-first protocol (PG is the source of truth for identity, not CH), need its own
  DLQ conflict target, and — because ADR-041's 2026-05-30 amendment withdrew the drift-reconciliation
  sweeps — require a bespoke repair path. That repair path was the actual scope of that option. This
  decision deletes it.

### Negative / risks

- **Scales with merge count.** The inline map is a query-embedded list. It is unremarkable at
  hundreds and fine at thousands, but it is not free. **This is the load-bearing assumption and it is
  currently unvalidated** — see "Open questions". If merges ever became routine, the fallback is a
  CH-local `ReplacingMergeTree` identity table with the dictionary re-pointed at it via
  `SOURCE(CLICKHOUSE(...))` — same query shape, no PG connection.
- **Two round-trips** (PG map → CH → PG labels) where there was one. The map is small and cacheable;
  the label lookup is bounded by page size.
- **A behavioural change around unknown addresses.** `dictGetOrNull` returns NULL for an address with
  no actor row, and `delegateLeaderboard` drops those (`WHERE actor_id IS NOT NULL`). Under
  `transform`, an unknown address maps to itself and survives to the LIMIT, resolving to no actor in
  step 3. Parity requires either dropping it in the app (yielding fewer than N rows) or over-fetching
  and trimming. Note today's behaviour is already inconsistent — `totalVotingPower` includes the
  addresses the numerator excludes, so shares do not sum to 1 when the dictionary has misses.
- **Cursor pagination on `delegateAlignmentPage`** ties break on `peer_actor_id`; the cursor must move
  to the canonical address. Believed mechanical, not yet traced.

### Neutral

- ADR-062's boundary is unchanged and arguably better honoured: PostgreSQL keeps identity, ClickHouse
  keeps chain-event-derived facts, and identity no longer leaks into CH as a replicated dictionary.
- ADR-033 is unaffected. Redirects remain the API-facing 301 mechanism; this decision only observes
  that the _analytics_ path never needed them, because merges rewrite `actor_address` in place.

## Alternatives considered

**Keep the dictionary, make its source configurable per environment** (PR #550, closed). Fixes the
outage and nothing else: the rule stays duplicated (it added a fourth copy), the CH→PG coupling and
credentials stay, the staleness stays. It also required an operator step whose `CREATE OR REPLACE`
swaps the dictionary _before_ verifying the load — so a wrong route breaks analytics until re-run.

**Keep the dictionary, single-source the definition.** Stops drift; leaves the outage class, the
coupling, and the staleness. Necessary but not sufficient.

**Dual-write identity into a CH `ReplacingMergeTree`, dictionary sourced from it.** Structurally
clean and removes the PG connection, but see "Positive" above: inverted write protocol, bespoke DLQ,
and an owned repair path — all to replicate a table that exists to serve a rare admin action.
Retained as the fallback if the merge-count assumption fails.

**Replace `dictGetOrNull` with a `LEFT JOIN` against a CH-local table.** Rejected: a LEFT JOIN
returns the type default (`00000000-0000-0000-0000-000000000000`), not NULL, unless the column is
`Nullable(UUID)` / `join_use_nulls=1`. That turns `WHERE actor_id IS NOT NULL` into a no-op on the
leaderboard, and flips alignment's `!= focalActorId` from dropping unknown voters to **retaining**
them — collapsing every unresolvable address into one synthetic actor whose summed power would
plausibly rank #1 and render with an empty `primary_address`. Strictly worse than the dictionary for
the same cost.

## Verification

The mechanism was tested against a real ClickHouse 24 before this ADR was written, using the exact
case that makes top-N-by-address wrong: a merged actor `M` owning two addresses (60 + 55 = 115) that
each rank _below_ three single-address actors (100, 90, 80).

```
top-2 by address (naive):    0xcc… 100,  0xdd… 90       ← M missing entirely
top-2 via transform():       0xaa… 115,  0xcc… 100      ← correct
```

The naive grouping omits the actor who should rank #1; the `transform` grouping ranks correctly with
the LIMIT still applied inside ClickHouse.

## Outcome

Implemented across five changes: merged-actor integration coverage (#573), the service-side resolver
and merge map (#574), the delegation reads (#575), the vote reads (#576), and dropping the dictionary
(this change). No `dictGet` call remains in the repo, and ClickHouse no longer opens a connection to
Postgres.

The two 500ing endpoints were verified fixed by running the rewritten reads read-only against
production PG + ClickHouse before merge, rather than inferring it from local tests.

### The open questions, answered

**1. How many merged actors exist in production? — Zero.** Measured before implementation: 62,635
actors against 62,635 `actor_address` rows, max one address per actor, no redirect rows, and no
`actors merge` ever run. Address→actor is currently a bijection, so the merge map is empty and the
inline `transform` is the identity function — which is what the dictionary computed, at the cost of
a live cross-database connection. The CH-local-table fallback is not needed and was not built.

This also means production traffic never exercises the merge path, which is why #573 landed
integration coverage first: a defect there would otherwise stay invisible until the next
`actors merge`, then silently corrupt a leaderboard.

**2. Unknown-address parity — resolved as a domain rule, not a heuristic.** Measurement showed the
only unresolvable address in the whole dataset is `address(0)`: 1 of 18,679 distinct delegates, 0 of
21,449 delegators, 0 of 14,126 voters. Delegating to the zero address is an *un*delegation, not a
delegate, so it is excluded from both the leaderboard page and its total. Shares now sum to 1 by
construction rather than by dropping rows, and no displayed figure moved — the zero address holds 0%
of standing power today.

**3. The resolver's `a.id` arm — load-bearing, keep it.** `findMergeMap` canonicalises onto
`actor.primary_address`, so that arm is what resolves the canonical address back to its actor when
the `actor_address` row is missing. All three arms are now documented in one place, which was the
drift this ADR set out to end.

**4. `findOrCreateActorAddress`'s two inserts with no transaction — still open.** Unrelated to this
decision and tracked separately. Note the `a.id` arm above covers the window it opens, so analytics
stay correct in the meantime.

### Found along the way

**A pre-existing defect in `currentVotingPowerByActor` (KNOWN-031).** It grouped by resolved actor
and took `argMax(voting_power, created_at)` over that group, so a merged actor spanning two delegator
addresses received only whichever address delegated most recently instead of the sum of both standing
figures — silently losing the rest of its power. Not reachable in production (zero merged actors) and
invisible to the mocked unit spec. The rewrite's group-by-address-then-fold-in-TypeScript shape fixes
it; it was carried as a deliberately failing test between #573 and #575.

**The alignment cursor was not merely mechanical.** `peer_actor_id` was the sort tiebreak in two
places — the ClickHouse `ORDER BY` and the encoded cursor payload in the controller — and both had to
move to the canonical address together, or a cursor would resume from a key the ranking no longer
sorts on.

## Open questions (at the time of writing)

Kept as the record of what was unknown when the decision was taken; each is answered under
"Outcome" above.

1. **How many merged actors exist in production?** The whole decision rests on this staying small.
   `admin_audit` holds the answer (`docs/runbooks/actor-merge.md` derives merge volume from it). This
   must be checked before implementation; a large number selects the CH-local-table fallback instead.
2. **Unknown-address parity** — drop in the app, or over-fetch and trim? Prefer resolving the
   pre-existing numerator/denominator inconsistency in the same change rather than preserving it.
3. **The PG resolver's `a.id` arm** — load-bearing, or defensive against the crash window below? Pick
   one definition and put it in one place.
4. **Unrelated but adjacent:** `findOrCreateActorAddress` issues its `actor` and `actor_address`
   inserts as two statements with **no enclosing transaction** (`actor-repository.ts:100-111`). A
   crash between them leaves an actor with no address row — invisible to analytics and unmergeable
   (`loadAddressRows` inner-joins `actor_address`). Worth fixing regardless of this ADR.
