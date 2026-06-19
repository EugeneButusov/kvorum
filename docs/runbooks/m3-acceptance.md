# M3 Acceptance Runbook — Aave integration (AC #1–#8)

**Scope:** validate every M3 acceptance criterion end-to-end after the Aave historical backfill
has run. This is the Y3 ([#270](https://github.com/EugeneButusov/kvorum/issues/270)) acceptance
gate — the operational counterpart to the developer-level gates already enforced in CI (Y2 stitch
test, conformance + analytics e2e, autocannon perf gate).

The canonical AC definitions live in
[`docs/planning/plan-m3.md` §"Acceptance criteria (M3 gate)"](../planning/plan-m3.md). This runbook
turns each into a copy-pasteable check with an explicit pass criterion.

Pairs with:

- `docs/runbooks/m3-multichain-backfill.md` — how to _fill_ the archive (run before this runbook).
- `docs/runbooks/m3-chains.md` — per-chain `CHAIN_CONFIG` / `headLag` provisioning.
- `docs/runbooks/m2-acceptance.md` — the M2 precedent this mirrors.

> **Order of operations.** Backfill writes `archive_event` (PG) + per-source ClickHouse archive rows
> only. The unified `proposal` / `vote_events_projection` / `aave_proposal_payload` entities that the
> AC checks read appear only after the **indexer derivation worker** drains the archive. Do not start
> AC validation until [Preconditions](#preconditions) all pass.

---

## ACs at a glance

| AC  | Claim                                                                              | Primary evidence                                                      | This runbook                                      |
| --- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| #1  | All historical v3 (all chains) + v2 proposals indexed; counts match on-chain truth | Backfill + derive; on-chain `getProposalsCount`                       | [§AC #1](#ac-1--all-historical-proposals-indexed) |
| #2  | Multi-chain proposals link to every destination payload execution                  | Y2 stitch test (synthetic) + real-data spot-check                     | [§AC #2](#ac-2--cross-chain-payload-stitching)    |
| #3  | Cross-DAO analytics return correct combined Compound+Aave results                  | `analytics-cross-dao.e2e` golden fixtures + live endpoint             | [§AC #3](#ac-3--cross-dao-analytics)              |
| #4  | Schema accommodates Aave with no core rework                                       | Migration history review                                              | [§AC #4](#ac-4--schema-unification)               |
| #5  | Aave votes carry correct `voting_power_reported`                                   | `vote_events_projection.voting_power` non-zero                        | [§AC #5](#ac-5--reported-voting-power)            |
| #6  | Lossy execution does not orphan the proposal/stitch graph                          | Y2 deliberate lossy case + real-data spot-check                       | [§AC #6](#ac-6--lossy-execution-resilience)       |
| #7  | API contract: §4.7 shapes, chain context, OpenAPI, perf                            | `conformance.e2e` + `autocannon-analytics` + committed `openapi.json` | [§AC #7](#ac-7--api-contract)                     |
| #8  | Operator can register + backfill all sources; metrics + DLQ; docs                  | The backfill run itself + this runbook set                            | [§AC #8](#ac-8--operability)                      |

ACs #2, #6, #7 (perf/shape), #3 are **already gated in CI** by deterministic tests; the steps below
re-confirm them on the real dataset and capture the operator-visible evidence. #1, #5, #8 require the
real backfill and are validated here for the first time. #4 is a design assertion.

---

## Helpers

```bash
alias psql='docker compose exec -T postgres psql -U kvorum -d kvorum'
alias chsql='docker compose exec -T clickhouse clickhouse-client'

# On-chain truth reads use Foundry `cast` (already a repo dependency; see docker-compose digest).
# Provide an archive RPC per chain — never commit credentialed URLs (ADR-028).
export MAINNET_RPC=https://...      # 0x1
# (per-chain RPCs as needed for payload-count cross-checks)
```

Seeded contract addresses (from `libs/sources/aave/migrations-postgres/aave_002_seed.ts`):

| Contract             | Chain | Address                                      |
| -------------------- | ----- | -------------------------------------------- |
| Governance v3        | `0x1` | `0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7` |
| Governor v2 (legacy) | `0x1` | `0xEC568fffba86c094cf06b22134B23074DFE2252c` |

---

## Preconditions

All three must hold before any AC check is meaningful.

**P1 — Backfill complete.** Every configured `(source_type, chain)` reached its confirmed head per
`m3-multichain-backfill.md` Phase 4. Re-confirm there are no `pending` / `error` sources in the last
`backfill run aave` summary.

**P2 — Derivation drained.** The indexer has processed the full archive backlog to zero:

```bash
psql -c "
  SELECT source_type, chain_id, count(*) AS underived
  FROM archive_event
  WHERE derived_at IS NULL
  GROUP BY 1, 2 ORDER BY 1, 2
"
```

Expected: **zero rows**, _except_ legitimate cross-chain stitch holds (a vote/payload whose mainnet
proposal genuinely does not exist yet — should be empty after a complete historical backfill). Any
held rows here must be explained before sign-off (see `m3-chains.md` §stitch-hold).

**P3 — DLQ clear.** No unresolved archive/derivation failures:

```bash
psql -c "
  SELECT stage, count(*)
  FROM ingestion_dlq
  WHERE accepted_at IS NULL AND resolved_at IS NULL
  GROUP BY stage ORDER BY stage
"
```

Expected: empty, or only `aave_ipfs_title_fetch` rows (title enrichment is best-effort and does **not**
block AC #1 — proposals index with a placeholder title per the S2 IPFS-fallback rule). Retry archive
stages with `admin-cli dlq retry <id>` before proceeding.

---

## AC #1 — All historical proposals indexed

**Claim.** Every historical Aave Governance v3 proposal (across all configured chains) and every
legacy v2 proposal is indexed, with row counts matching on-chain truth.

### 1a. Internal: derived vs archive (lossless pipeline)

Proposals are created from mainnet governance events, so the proposal count is anchored on `0x1`.
Cross-chain votes/payloads are counted separately (AC #2/#5).

```bash
# Derived proposals per governance source
psql -c "
  SELECT p.source_type, count(*) AS proposals
  FROM proposal p
  JOIN dao d ON d.id = p.dao_id
  WHERE d.slug = 'aave'
  GROUP BY 1 ORDER BY 1
"
```

Reconcile against the distinct proposal-creating archive events:

```bash
psql -c "
  SELECT ae.source_type, count(*) FILTER (WHERE ae.event_type = 'ProposalCreated') AS created_v3,
         count(*) FILTER (WHERE ae.event_type = 'ProposalCreated') AS created_any
  FROM archive_event ae
  JOIN dao_source ds ON ds.id = ae.dao_source_id
  JOIN dao d ON d.id = ds.dao_id
  WHERE d.slug = 'aave' AND ae.source_type IN ('aave_governance_v3','aave_governor_v2')
  GROUP BY 1 ORDER BY 1
"
```

**Pass:** `proposals` per source == count of distinct proposal-creation archive events for that
source. A shortfall means underived rows (revisit P2) or a derivation DLQ (revisit P3).

### 1b. External truth: on-chain proposal count

The Governance v3 and Governor v2 contracts expose an authoritative total. This is the cheapest
on-chain truth for the headline count — no third-party indexer required.

```bash
# Aave Governance v3 — total proposals ever created
cast call 0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7 "getProposalsCount()(uint256)" --rpc-url "$MAINNET_RPC"

# Aave Governor v2 — legacy total
cast call 0xEC568fffba86c094cf06b22134B23074DFE2252c "getProposalsCount()(uint256)" --rpc-url "$MAINNET_RPC"
```

> **Confirm the getter signature.** `getProposalsCount()` (governance) and `getPayloadsCount()`
> (PayloadsController, §AC #2) are **not** vendored in this repo — only the event ABIs and the
> `getPayloadById` reconcile getter are. Confirm the exact signatures against the deployed contract
> ABI (`@bgd-labs/aave-address-book`) before relying on them; a wrong signature simply reverts the
> `cast call`. The Aave Governance v3 core and v2 governor both expose a proposal-count getter as of
> this writing.

**Pass:** derived `proposal` count for `aave_governance_v3` == v3 `getProposalsCount()`; same for v2.
Proposal ids are sequential per contract, so a count match also proves no interior gaps. If counts
differ, list the missing ids:

```bash
# Example: find gaps in the v3 source_id sequence (source_id is the on-chain proposal id)
psql -c "
  WITH ids AS (
    SELECT (p.source_id)::bigint AS id
    FROM proposal p JOIN dao d ON d.id = p.dao_id
    WHERE d.slug = 'aave' AND p.source_type = 'aave_governance_v3'
  )
  SELECT g AS missing_id
  FROM generate_series(0, (SELECT max(id) FROM ids)) g
  LEFT JOIN ids ON ids.id = g
  WHERE ids.id IS NULL
  ORDER BY g
"
```

### 1c. Per-chain archive reference table

Record the per-`(source_type, chain)` archive counts as the durable reference (the
`m3-multichain-backfill.md` Phase 4 query). Fill the [reference table](#per-chain-reference-counts)
at the bottom so future re-runs have a baseline.

---

## AC #2 — Cross-chain payload stitching

**Claim.** A multi-chain proposal's mainnet entity links to all destination-chain payload
executions; `status='executed'` + `executed_at_destination` set where the destination confirmed.

**CI gate (authoritative for structure):** `tests/e2e/aave-multichain-stitch.e2e.spec.ts` (Y2) proves
the in-order, out-of-order/held, and lossy paths on synthetic-but-ABI-real data. Re-confirm it is
green at the release SHA.

### Real-data confirmation

Every executed payload must carry a destination timestamp; no executed payload may have a NULL
timestamp, and no declared-but-stuck payload may claim execution:

```bash
psql -c "
  SELECT app.status, count(*) AS n,
         count(*) FILTER (WHERE app.executed_at_destination IS NOT NULL) AS with_ts
  FROM aave_proposal_payload app
  JOIN proposal p ON p.id = app.proposal_id
  JOIN dao d ON d.id = p.dao_id
  WHERE d.slug = 'aave'
  GROUP BY 1 ORDER BY 1
"
```

**Pass:** for `status='executed'`, `with_ts == n` (every executed payload has a timestamp); for all
other statuses, `with_ts == 0`.

### Spot-check a known multi-chain proposal

Pick a well-known cross-chain proposal (one that executed payloads on ≥2 chains). Cross-reference its
payload set against the **Aave governance UI** (app.aave.com/governance) and/or **Tally** /
**BGD governance subgraph**:

```bash
psql -c "
  SELECT app.target_chain_id, app.payload_id, app.status, app.executed_at_destination
  FROM aave_proposal_payload app
  JOIN proposal p ON p.id = app.proposal_id
  JOIN dao d ON d.id = p.dao_id
  WHERE d.slug = 'aave' AND p.source_id = '<known_proposal_id>'
  ORDER BY app.target_chain_id
"
```

Optionally confirm each payload's on-chain state directly (PayloadsController per chain). The
`getPayloadById` signature is vendored in `libs/sources/aave/src/payloads-controller/abi/payload-state.ts`;
the `state` field (index 2 of the returned struct) maps `0=none, 1=created, 2=queued, 3=executed,
4=cancelled, 5=expired`:

```bash
cast call <payloads_controller_addr> \
  "getPayloadById(uint40)(address,uint8,uint8,uint40,uint40,uint40,uint40,uint40,uint40,uint40,(address,bool,uint8,uint256,string,bytes)[])" \
  <payload_id> --rpc-url "$<chain>_RPC"
# the 3rd returned field (uint8 state) is the PayloadState enum above
```

**Pass:** the per-chain payload set + statuses match the external reference for the sampled proposal.

---

## AC #3 — Cross-DAO analytics

**Claim.** Cross-DAO analytical queries return correct combined Compound + Aave results.

**CI gate:** `tests/e2e/analytics-cross-dao.e2e.spec.ts` validates the combined-set math against
golden fixtures. Re-confirm green at the release SHA.

### Live confirmation

With both DAOs present, hit the cross-DAO endpoint and confirm Aave contributes to the combined
result (non-vacuous):

```bash
curl -s -H "Authorization: Bearer $API_KEY" \
  "$API_BASE/v1/analytics/cross-dao/<metric>" | jq '.'
```

**Pass:** response includes both DAOs; the combined aggregate is internally consistent (spot-check one
metric against the per-DAO values, e.g. cross-DAO actor overlap is non-empty if any address voted in
both). The Gini cross-check procedure in `m2-acceptance.md` §"AC #4 Gini cross-check" applies to the
concentration metric.

---

## AC #4 — Schema unification

**Claim.** Core entities required no structural change to accommodate Aave beyond the pre-sanctioned
extension tables (`aave_proposal_metadata`, `aave_proposal_payload`) + a chain dimension on votes.
This is the ratified AC #4 reinterpretation (ADR-064 amendment), not the literal "zero changes" —
see the plan-m3 §"Note on AC #4".

### Confirmation (design review, not a runtime query)

```bash
# Aave-specific tables added — should be exactly the two extension tables.
git log --oneline -- 'libs/sources/aave/migrations-postgres/*' | head
```

**Pass:** the only Aave-specific _core-adjacent_ schema additions are the two extension tables + the
`dao_source.chain_id` / `vote_events_projection.voting_chain_id` chain dimension (added in Epic R for
all sources, not Aave-specifically). No column was added to `proposal` / `actor` / `delegation`
_semantics_ for Aave. Record this assertion in the acceptance report with the migration list as
evidence.

---

## AC #5 — Reported voting power

**Claim.** Aave votes carry correct `voting_power_reported` (from `VoteEmitted` on the voting chain),
stored on the vote row in `vote_events_projection.voting_power`. No separate `voting_power_snapshot`
table exists (retired in M3 V3 #262); no runtime sample-verification loop remains.

```bash
# Aave dao_id
psql -tA -c "SELECT id FROM dao WHERE slug = 'aave'"

chsql -q "
  SELECT voting_chain_id,
         count(*)                                   AS votes,
         countIf(voting_power = 0)                  AS zero_power
  FROM vote_events_projection
  WHERE dao_id = '<aave_dao_id>'
  GROUP BY voting_chain_id
  ORDER BY voting_chain_id
"
```

**Pass:** votes exist on each expected voting chain (`0x1`, `0x89`, `0xa86a`); `zero_power` is 0 (or
explained — a genuine zero-weight vote is rare but legal). Confirm no snapshot table:

```bash
psql -c "\dt voting_power_snapshot"   # expect: "Did not find any relation"
```

---

## AC #6 — Lossy-execution resilience

**Claim.** A payload that fails / is never executed / expires on one chain does **not** orphan the
proposal or block the rest of the stitch graph; the gap is expressed via `status`, never a silent
NULL.

**CI gate (authoritative):** the deliberate lossy case in `aave-multichain-stitch.e2e.spec.ts` (Y2) —
Optimism `PayloadExecuted` omitted; asserts proposal `executed`, sibling payload `executed`, lossy
payload `queued` with `executed_at_destination = NULL`.

### Real-data confirmation

Find proposals with at least one executed and at least one non-executed payload, and assert the
proposal itself is not degraded:

```bash
psql -c "
  SELECT p.source_id, p.state,
         count(*) FILTER (WHERE app.status = 'executed')  AS executed_payloads,
         count(*) FILTER (WHERE app.status <> 'executed')  AS unexecuted_payloads
  FROM proposal p
  JOIN aave_proposal_payload app ON app.proposal_id = p.id
  JOIN dao d ON d.id = p.dao_id
  WHERE d.slug = 'aave'
  GROUP BY p.id, p.source_id, p.state
  HAVING count(*) FILTER (WHERE app.status <> 'executed') > 0
     AND count(*) FILTER (WHERE app.status = 'executed') > 0
  ORDER BY p.source_id
"
```

**Pass:** every such proposal has a coherent `state` (the missing payload did not push it to an error
state), and the gap is visible as a non-`executed` `status` — not a NULL masquerading as success.
Truly-unmatched payloads (no declaration) would surface via `indexer_stitch_unmatched_payload` during
derivation; confirm that metric settled to zero.

---

## AC #7 — API contract

**Claim.** Every Aave entity + analytical endpoint returns SPEC §4.7-shaped responses with chain
context surfaced; cursor/filter/sort/ETag work; OpenAPI 3.1 regenerated + committed; p95 < 500ms
entity / p99 < 5s analytical.

### Shape + chain context (CI gate)

`tests/e2e/conformance.e2e.spec.ts` pins body-shape + ETag snapshots and §4.7 invariants;
`tests/e2e/aave-entities.e2e.spec.ts` asserts chain context (voting chain on votes, payloads grouped
by destination chain with per-payload status). Re-confirm both green at the release SHA.

### OpenAPI committed

```bash
git diff --exit-code -- docs/openapi.json   # expect: no diff (regenerated + committed at the tag)
```

### Performance gate

```bash
API_KEY=<key> pnpm --filter api script:autocannon-analytics
```

**Pass:** `proposal-pass-rate` p95 < 500ms; `concentration`, `delegation-flow`, `delegate-alignment`,
`cross-dao` p99 < 5s (same thresholds as `m2-acceptance.md`, now over the larger multi-chain dataset).

---

## AC #8 — Operability

**Claim.** An operator can register all Aave sources across all configured chains and run the v3 + v2
backfill via `admin-cli`; metrics + DLQ stages exist per new ingestion stream; `docs/metrics.md` +
runbooks are updated.

This AC is **demonstrated by the backfill run itself** plus the documentation set. Confirm:

- [ ] `admin-cli backfill run aave --dry-run` readiness gate passed for every configured chain
      (`m3-multichain-backfill.md` Phase 2).
- [ ] The run completed with a per-source `completed`/`skipped` summary (no unexplained `error`).
- [ ] DLQ stages resolve via `admin-cli dlq retry` (`archive_event_stage`,
      `aave_governor_v2_archive_write`, `aave_ipfs_title_fetch`).
- [ ] `docs/metrics.md` enumerates the Aave `indexer_*` metric families (stitch-pending,
      unmatched-payload, derivation).
- [ ] Runbooks present: `m3-chains.md`, `m3-multichain-backfill.md`, this file.

---

## External cross-check methodology

AC #1/#2 require comparison against on-chain truth. Use the cheapest authoritative source per layer:

| Layer                                                       | Reference source                                          | Method                                                                                         |
| ----------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Proposal **count**                                          | The governance contract itself                            | `cast call … getProposalsCount()` (§AC #1b) — authoritative, sequential ids, no indexer needed |
| Payload **set / state** per proposal                        | PayloadsController per chain                              | `cast call … getPayloadById(uint40)` (§AC #2)                                                  |
| Structural **sample** (votes, proposers, multi-chain links) | Tally / BGD governance subgraph / app.aave.com/governance | Manual cross-reference for the sampled proposals below                                         |

**Sample selection (minimum):**

1. One **simple mainnet-only** proposal (v3) — sanity baseline.
2. One **known multi-chain** proposal that executed on ≥2 chains — exercises the full stitch.
3. One **lossy** case — a proposal with a declared payload that never executed / expired (AC #6).
4. One **v2 legacy** proposal — confirms the legacy governor path.

Record each sample's id + the reference values + the observed DB values in the acceptance report.

---

## Per-chain reference counts

Fill during the real run; this becomes the regression baseline for future backfills.

| source_type              | chain_id                   | archive rows | max block | derived entities | on-chain ref          | ✓   |
| ------------------------ | -------------------------- | ------------ | --------- | ---------------- | --------------------- | --- |
| aave_governance_v3       | 0x1                        |              |           |                  | `getProposalsCount()` |     |
| aave_governor_v2         | 0x1                        |              |           |                  | `getProposalsCount()` |     |
| aave_token               | 0x1                        |              |           |                  | —                     |     |
| aave_voting_machine      | 0x1                        |              |           |                  | —                     |     |
| aave_voting_machine      | 0x89                       |              |           |                  | —                     |     |
| aave_voting_machine      | 0xa86a                     |              |           |                  | —                     |     |
| aave_payloads_controller | 0x1                        |              |           |                  | `getPayloadsCount()`  |     |
| aave_payloads_controller | 0x89                       |              |           |                  | `getPayloadsCount()`  |     |
| aave_payloads_controller | 0xa86a                     |              |           |                  | `getPayloadsCount()`  |     |
| aave_payloads_controller | 0xa4b1                     |              |           |                  | `getPayloadsCount()`  |     |
| aave_payloads_controller | 0xa                        |              |           |                  | `getPayloadsCount()`  |     |
| aave_payloads_controller | 0x2105                     |              |           |                  | `getPayloadsCount()`  |     |
| aave_payloads_controller | 0x64                       |              |           |                  | `getPayloadsCount()`  |     |
| aave_payloads_controller | 0x38                       |              |           |                  | `getPayloadsCount()`  |     |
| aave_payloads_controller | 0x82750                    |              |           |                  | `getPayloadsCount()`  |     |
| aave_payloads_controller | 0xe708                     |              |           |                  | `getPayloadsCount()`  |     |
| aave_payloads_controller | 0xa4ec                     |              |           |                  | `getPayloadsCount()`  |     |
| aave_payloads_controller | 0x92                       |              |           |                  | `getPayloadsCount()`  |     |
| aave_payloads_controller | 0x440 (Metis, deprecated)  |              |           |                  | `getPayloadsCount()`  |     |
| aave_payloads_controller | 0x144 (zkSync, deprecated) |              |           |                  | `getPayloadsCount()`  |     |

---

## Emergency-action edge cases → ADR-068

Aave's historical governance includes emergency executions that bypass the normal proposal lifecycle
(KNOWN-003: emergency-action governance is not modeled). The real backfill is the first time these
surface against real data.

**If an emergency action / unmodeled lifecycle path is encountered during validation:**

1. Capture the proposal id, chain, and the divergence (e.g. an execution with no matching
   `ProposalCreated`, or a state transition the projector does not handle).
2. Decide: is it benign (indexes correctly, just unusual) or a modeling gap (orphans / mis-states an
   entity)?
3. If a modeling gap: write **ADR-068** documenting the case, the decision (model it / accept the gap
   / defer to M4), and any schema or projector follow-up. Do **not** silently patch — the ADR is the
   acceptance artifact.

---

## Sign-off checklist

Copy into the acceptance report; tick each AC in the [#270](https://github.com/EugeneButusov/kvorum/issues/270) issue.

- [ ] **P1–P3** preconditions pass (backfill complete, derivation drained, DLQ clear)
- [ ] **AC #1** — derived == archive == on-chain `getProposalsCount()` (v3 + v2)
- [ ] **AC #2** — every executed payload has a timestamp; sampled multi-chain proposal matches reference
- [ ] **AC #3** — cross-DAO analytics non-vacuous + Gini cross-check within 0.001
- [ ] **AC #4** — only extension tables + chain dimension added (migration review)
- [ ] **AC #5** — Aave votes carry non-zero `voting_power`; no snapshot table
- [ ] **AC #6** — lossy proposals keep coherent state; gaps visible via `status`
- [ ] **AC #7** — conformance + chain-context e2e green; `openapi.json` committed; perf thresholds met
- [ ] **AC #8** — backfill ran via `admin-cli`; DLQ retriable; metrics + runbooks present
- [ ] Per-chain reference table filled
- [ ] ADR-068 written if any emergency-action edge case surfaced
- [ ] `docs/retro-m3.md` updated with real-run results
