# ADR-0070 — Aave token delegation parity (lean cut)

**Status:** Accepted
**Date:** 2026-06-17
**Deciders:** Eugene
**Cross-refs:** Implements M3 X2 (issue #266) delegation half; mirrors the Compound `comp-token` delegation source; reuses ADR-041 (cross-DB write protocol), ADR-045 (metric naming); precedent ADR-039 (per-source derivation note).

---

## Context

The unified delegation surface (`/v1/daos/:slug/delegations`, `delegation_flow_projection`) is populated for Compound via the COMP-token `DelegateChanged` / `DelegateVotesChanged` events. For protocol **parity** (the v1.0 goal — the unified model serves every DAO uniformly), Aave must populate delegation too: delegation is a core entity another protocol already exposes, not a fidelity extra.

Aave's delegation, however, differs structurally from Compound's in ways that make a literal 1:1 port impossible:

1. **No power-delta event in V3.** `AaveTokenV3` (the implementation live on the AAVE proxy `0x7Fc66500…E2DDaE9` since the ~2023-12-26 upgrade to impl `0x5D4Aa78B…`) emits **only** `DelegateChanged(address indexed delegator, address indexed delegatee, GovernancePowerType delegationType)`. It **deliberately removed** `DelegatedPowerChanged` (source comment: "to reconstruct the full state of the system, is enough to have Transfer and DelegateChanged"). There is no Compound-style `DelegateVotesChanged` analog, so a per-delegation **voting-power amount** cannot be sourced from a single event.
2. **Two power types.** Aave delegates **voting** and **proposition** power separately (`GovernancePowerType { VOTING = 0, PROPOSITION = 1 }`).
3. **Three governance tokens.** Aave voting power is AAVE + stkAAVE + aAAVE, each independently delegable.
4. **`address(0)` is the undelegation sentinel.** V3 normalizes `delegatee == delegator ? address(0) : delegatee` **before emitting**, so self-delegation/undelegation surfaces as `DelegateChanged(delegator, address(0), type)`. `address(0)` is the canonical "no delegation" state.
5. **ABI break across V2→V3.** The pre-V3 `AaveTokenV2` implementation had delegation with a _different_ ABI (`enum DelegationType { VOTING_POWER, PROPOSITION_POWER }` + `DelegatedPowerChanged`).

The unified `delegation_flow_projection` models a **single** `(delegator → delegate, voting_power)` relationship per DAO — no token dimension, no delegation-type dimension, single-chain — because Compound has exactly one token and one delegation type.

## Decision

Ship a **lean parity cut** that maps Aave delegation onto the **unchanged** `delegation_flow_projection`:

- **AAVE token only** (the canonical, dominant governance token). stkAAVE + aAAVE are deferred.
- **VOTING power only.** `PROPOSITION`-power `DelegateChanged` events are archived but **not** projected (no-op derive: marked derived, no projection row). Proposition delegation is deferred.
- **Relationship-only.** Each VOTING `DelegateChanged` projects one `event_type = 'delegate_changed'` row with `delegate_address = delegatee` (or `ZERO_DELEGATE_ADDRESS → null` when `address(0)`), and **`voting_power = '0'`** — identical to Compound's `delegate_changed` rows. There is **no** `votes_changed` row for Aave (V3 emits no power-delta event), so the per-delegation power _amount_ is not surfaced.
- **V3-only.** `active_from_block` is the V3 proxy-upgrade block (~18870593, operator-verified). Pre-V3 (V2-ABI) delegation history is **not** ingested.
- **Single-chain (`0x1`).** AAVE/stkAAVE/aAAVE governance power lives only on Ethereum mainnet; L2s host voting machines, not the delegable governance token. The ingester's `supportedChainIds = ['0x1']`.

The source (`libs/sources/aave/src/aave-token/`) mirrors `libs/sources/compound/src/comp-token/` but emits a single event type. It writes the archive CH-first (ADR-041), derives via a `ProjectionDeriver` registered on `(aave_token, DelegateChanged)`, and reuses the shared `delegation_projection_stage` DLQ stage. An `AaveTokenActorAddressDeriver` materializes delegator/delegatee actors (skipping `address(0)`).

## Consequences

- `/v1/daos/aave/delegations`, `.../delegates/{addr}/current`, `.../actors/{addr}/delegation` return real Aave voting-power **delegation relationships** with semantics identical to Compound's `delegate_changed` rows. "Current delegate" stays single-valued (one VOTING relationship per delegator).
- **Aave delegation rows carry `voting_power = '0'`.** The relationship is at parity with Compound; the per-delegation power _figure_ is not. A consumer wanting Aave delegate power must read it elsewhere (the vote row's `voting_power_reported`, or a future holder-complete surface).
- **No schema change, no projection rebuild, no Compound-read change.** The unified model absorbs Aave delegation as-is — a concrete validation of the SPEC §2 unification claim for the delegation entity.
- The deferred fidelity is explicit, not silent: **per-delegation power** (would need `Transfer`-event balance tracking), **stkAAVE/aAAVE**, **proposition-power**, and **pre-V3 history** all require a `(token, type)` dimension on `delegation_flow_projection` (a rebuild + its own ADR, analogous to the X1 vote-chain-dimension rebuild) plus a second (V2) ABI path. None is in scope for M3.

## Alternatives considered

- **Per-delegation power via `Transfer` tracking.** Reconstruct each delegator's AAVE balance from `Transfer` history to attribute power to the delegate. Materially larger (full balance reconstruction); arguably its own task. Rejected for the lean cut — power is fidelity, not parity.
- **Add `(token, type)` dimensions to `delegation_flow_projection` now.** A rebuild touching Compound's reads, for stkAAVE/aAAVE/proposition completeness. Rejected — over-fidelity for v1.0; the relationship parity is what matters.
- **Endpoint parity only (return empty for Aave).** Rejected — delegation data exists on-chain; empty would under-deliver the parity goal.
