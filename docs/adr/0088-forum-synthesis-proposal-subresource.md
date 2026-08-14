# ADR-0088 — Forum synthesis is exposed as a proposal sub-resource, not a thread-addressed route

- **Status**: Accepted
- **Date**: 2026-08-10
- **Spec sections affected**: 5.4
- **Amends**: SPEC §5.4 (dedicated forum-synthesis endpoint path)
- **Related**: ADR-078 (AI infrastructure + queue), ADR-079 (provenance contract), #444 (forum-synthesis endpoint), #449 (dedicated AI endpoints)
- **Implemented by**: #444 (the endpoint), #449 (this note)

## Context

SPEC §5.4 lists the dedicated forum-synthesis endpoint as:

> `GET /v1/daos/{slug}/forum-threads/{external_id}/ai/synthesis` — fetch the forum thread synthesis.

That path was never built. #444 instead shipped forum synthesis as a **proposal sub-resource**:

> `GET /v1/daos/{slug}/proposals/{source_type}/{source_id}/ai/forum-synthesis`

joining the proposal AI family (`/ai/summary`, `/ai/mismatch`, `/similar`). The #444 PR said it would
leave "a one-line SPEC/ADR note" recording the divergence; that note never landed. This ADR is that note.

SPEC is itself inconsistent on the prefix: §5.4 uses `/forum-threads/{external_id}/ai/synthesis`, §6.5
uses `/forum-threads/{external_id}`, and §6.12 uses `/daos/{slug}/forum/{external_id}` — and the plain
forum-thread **read** actually shipped (#516) at `GET /v1/daos/{slug}/forum/{external_id}` (in
`nest/sources/forum`), not `/forum-threads/`.

## Decision

Forum synthesis is served **only** as the proposal sub-resource
`GET /v1/daos/{slug}/proposals/{source_type}/{source_id}/ai/forum-synthesis`. There is **no**
`external_id`-addressed synthesis route in v1. The literal SPEC §5.4 path is superseded.

Two forces drive this:

1. **The source-blind boundary makes a thread-addressed route infeasible in `apps/api`.** ESLint bans
   `@sources/*` imports from `apps/api/src` (`eslint.config.js`), so `apps/api` reaches forum content
   only through the `SOURCE_READ_EXTENSIONS` seam (`@libs/domain`) — whose methods are **keyed by
   `proposalId`** (`getOffchainDiscussionContent?(proposalId)`), not by forum `external_id`. There is no
   `external_id → raw_content` path available to `ProposalController`. The synthesis lookup itself is
   source-blind (content-addressed by `sha256(raw_content)` in `ai_output`), but the _resolution_ of a
   thread's `raw_content` from an `external_id` requires the forum source package.

2. **Proposal-connectedness is the product intent** (recorded in #444): a proposal viewer gets the
   discussion synthesis without needing the thread's `external_id`; the endpoint resolves
   proposal → highest-confidence linked thread → its content-addressed synthesis.

Provenance and null-handling are unchanged and match the rest of the AI family: the response carries a
`_meta` with `ai_generated` + model/prompt_version/input_hash/generated_at; a non-English thread yields
`200 { data: null, _meta: { ai_generated: false, skipped_reason: 'non_english' } }`; a missing
proposal / unlinked thread / unprocessed synthesis yields 404.

## Consequences

- #449's "four dedicated endpoints" are satisfied: `/ai/summary`, `/ai/mismatch`, `/similar`, and forum
  synthesis (as the proposal sub-resource).
- A **thread-addressed** synthesis endpoint (for consumers holding an `external_id` but no proposal) is
  **deferred**. If v1.1 wants it, the feasible home is `nest/sources/forum` — the layer that already
  hosts `GET /forum/{external_id}` and may import `@sources/forum` — pairing `ForumThreadReadRepository`
  (`external_id → raw_content`) with the source-blind `ForumSynthesisReadService`. Its natural path would
  be `GET /v1/daos/{slug}/forum/{external_id}/ai/synthesis` (matching the shipped read prefix), a third
  shape versus SPEC §5.4's literal `/forum-threads/...`.
- SPEC §5.4's `/forum-threads/{external_id}/ai/synthesis` bullet is superseded by this ADR; treat the
  proposal sub-resource as the v1 contract.
