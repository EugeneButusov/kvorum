# ADR-081 — Proposal embedding composition (stable, change-controlled)

- **Status**: Proposed
- **Date**: 2026-07-31
- **Spec sections affected**: 5.8, 5.9
- **Related**: ADR-078 (AI infrastructure + queue), ADR-079 (cost/cap/provenance), #445 (`proposal_embedding` + pgvector), #447 (similarity API), M5-7 (backfill)
- **Implemented by**: #446 (embed worker + composed input + this ADR)

## Context

SPEC §5.8 embeds every proposal above `pending` into a 1,536-dim vector (`text-embedding-3-small`) for
cross-DAO "similar proposals" search. The input is a **deterministic composed text** — the proposal's
`title`, `description`, and a one-line summary of decoded actions — and is **versioned**. SPEC §5.9
leaves open whether the composition should evolve over the project's life, "leaning toward a stable
composition for v1, change-controlled via ADR if revised." This ADR records that composition and its
change-control mechanism.

Two properties make embeddings different from the completion features (summarizer/mismatch): the
composed string is **both** what the model ingests **and** the cache/hash source (there is no separate
rendered prompt), and the #447 similarity API **never recomposes** — it looks up a proposal's stored
vector and runs a cosine query. So the "worker and API must produce byte-identical input" constraint
that pushes the other features toward canonical JSON does not apply here; the deciding axis is
embedding quality.

## Decision

### 1. Natural-text composition (not JSON)

The embedded text is human-readable, blank-line separated:

```
<title>                       ← line + its separator omitted when title is null/blank
<description>                 ← truncated to DESCRIPTION_CHAR_CAP
<action-line>
```

`text-embedding-3-small` is trained on prose; title+description are already natural language.
Embedding a canonical-JSON blob would inject constant structural tokens (keys, quotes, escaped
newlines) that bias every proposal toward every other, plus opaque 40-char hex addresses and 78-digit
`value_wei` that dilute the semantic signal and consume the ~8,191-token input budget — all working
against the cross-DAO _intent_ similarity that is the feature's entire purpose.

### 2. Action line — function names only

`Actions (<n>): <name1>, <name2>, …`, names in `action_index` order (NOT de-duped — repetition is
meaningful shape), each resolved `decoded_function` → bare signature name (text before `(`) → the
literal `raw call`. Empty actions → the sentinel `No on-chain actions.`.

Function names (`setReserveFactor`, `transfer`, `upgradeTo`) recur across DAOs on shared governor
frameworks and carry strong cross-DAO similarity signal. Target addresses and decoded arguments are
opaque, rarely match across DAOs, and add token noise — so they are excluded from v1. The description
already carries target/amount context in prose.

### 3. `title` null/blank

Treated as unavailable when `title` is null or whitespace-only; its line and separator are omitted.

### 4. Deterministic description cap

`description.slice(0, 24_000)` (~well under the model's token cap at ~4 chars/token), frozen by the
version. A long proposal still embeds (slightly truncated) rather than hard-failing the API into the
DLQ. The truncation is a documented quality tradeoff for the rare over-long proposal.

### 5. Hash the literal embed string

`input_hash = sha256(composed string)` — the exact bytes embedded. Hashing a _different_ canonical
structure than what is embedded could let a composition tweak change the embedded text without
changing the hash, cache-hitting a stale vector. Hashing the literal string makes "unchanged input ⇒
cache hit (no API call)" airtight.

### 6. `embedding_version` = `<model>/vN` — the change-control gate

`text-embedding-3-small/v1`. The model segment auto-versions a provider/model swap; the `vN` segment
is the composition version. **Any change to the composition (functions above, separators, labels, the
cap) MUST bump `vN` in the same commit.** A golden snapshot test pins the exact composed string, so an
accidental composition edit fails CI unless the version is also bumped — this is the SPEC §5.9
change-control mechanism. Because the cache-check keys on `(proposal_id, embedding_version)`, a bump
makes every lookup miss and re-embeds the corpus into **new** rows; old-version rows are retained and
#447 filters to the current version.

## Alternatives considered

- **Canonical-JSON composition** (reuse `serializeDecodedActions`/`canonicalInputContent`): maximal
  determinism with existing helpers, but embeds structural + hex/uint256 noise that hurts semantic
  similarity, and the determinism benefit (byte-identical worker/API input) doesn't apply since #447
  never recomposes. Rejected.
- **Action line with target addresses and/or decoded arguments**: more on-chain specificity, but raw
  addresses are opaque and bias similarity toward "same address" over "same intent"; decoded arguments
  are arbitrary jsonb, hard to render deterministically. Rejected for v1.

## Consequences

- A `vN` bump re-embeds the whole corpus (~$0.15 one-time for the ~1,500 historical proposals,
  trivially under the $1 cap) — the intended, change-controlled cost.
- Old-version embedding rows remain; the #447 similarity query MUST filter on the current
  `embedding_version`.
- Long-proposal truncation is a documented recall tradeoff for the rare over-cap description.
- Embedding an action set before decode completes yields a coarse action line; when decoding finishes
  the composed input genuinely changes → the next scan re-embeds (cache miss). Proposal _state_ is
  deliberately excluded from the composition, so pure state churn never triggers a re-embed.
