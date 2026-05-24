# ADR-033 — Actor merge produces HTTP 301 redirects on canonical URLs

- **Status**: Accepted
- **Date**: 2026-05-08; rider 2026-05-20 (M2 review)
- **Spec sections affected**: 2.4.3, 4.2, 6.10, 6.20.1 (rider), 2.8 invariant 4 (rider)
- **Related**: invariant 2.8.4

## Context

SPEC §2.4.3 supports actor merging: "When two actors are identified as the same entity, a merge operation rewrites foreign keys and consolidates them into one." SPEC §4.2 identifies actors by their primary address in URLs (`/v1/actors/{address}`). SPEC §2.8 invariant 4 declares actors "mergeable, never deletable."

What happens to URLs after a merge is unspecified. Concretely: actor A (primary `0xaaa...`) and actor B (primary `0xbbb...`) merge into surviving actor A. The URL `/v1/actors/0xbbb...` previously resolved to actor B. Post-merge it must do _something_. Plausible behaviors:

1. **404 Not Found.** Wrong: the address is real, the actor was real, the data still exists.
2. **200 OK with actor A's data.** Silently changes the meaning of the URL — confusing for cached clients and links in external articles.
3. **301 Permanent Redirect to A's URL.** Standard HTTP semantics for a moved resource; preserves external links.
4. **410 Gone.** Semantically defensible (the resource at this URL is permanently gone) but breaks every external link and screenshot that referenced B's address.

External links to actor pages are common — articles citing delegate behavior, governance reports, even Twitter posts. Breaking them with 410 Gone optimizes the wrong thing.

## Decision

After an actor merge, secondary primary addresses respond with HTTP 301 Permanent Redirect to the survivor's canonical URL. The dashboard performs the equivalent client-side redirect.

Implementation:

A new table `actor_address_redirect`:

```
actor_address_redirect(
  from_address  text primary key,    -- lowercase
  to_actor_id   uuid not null fk -> actor.id,
  merged_at     timestamptz not null,
  merge_reason  text not null,        -- audit; matches admin_audit entry
  created_by    text not null         -- operator identity from admin-cli actor merge
)
```

Routing precedence (per request):

1. Look up `actor` by primary address. Found → serve 200.
2. Else look up `actor_address_redirect` by from_address. Found → 301 to `/v1/actors/{survivor.primary_address}`.
3. Else look up `actor_address` (the multi-address mapping from §2.4.3). Found → 301 to the actor's primary address (this also handles the non-merge case where a non-primary address is queried).
4. Else 404.

Both API and dashboard honor the redirect. The API includes the canonical URL in the `Location` header per HTTP convention; the dashboard performs a client-side `router.replace` to keep the URL bar in sync.

The `actor merge` admin command (§6.20.1) populates `actor_address_redirect` as part of the merge transaction. Merges are part of `admin_audit` per §6.20.1's existing policy.

## Alternatives considered

- **410 Gone.** Correct semantically for a "this URL no longer exists" case, but every external link breaks. SEO penalty; user confusion.
- **200 OK with the survivor's data, no redirect.** URL silently changes meaning; cached responses across the chain are wrong; bookmarks point to a different actor than they once did.
- **Long-lived 302 (temporary) redirect.** Search engines treat 302 as non-canonical; the redirect destination doesn't accumulate authority. 301 is the right signal for a permanent move.
- **Maintain B as a phantom actor with no data.** Defeats the merge — the whole point is consolidating B's history into A.

## Consequences

- External links and screenshots continue to work after merges. SEO updates naturally.
- The `actor_address_redirect` table is small (one row per merged-away primary address); permanent.
- The dashboard's URL bar reflects the canonical address after redirect, not the original — visually consistent with the data shown.
- `admin-cli actor merge --dry-run` (§6.20.1) shows the redirect rows that would be created, allowing an operator to verify before committing.
- §2.8 invariant 4 ("Actor identities are mergeable, never deletable") gains an explicit corollary: the address-as-URL contract survives merges via redirect.
- The same routing precedence handles the non-merge case where a query targets a non-primary address (§2.4.3's multi-address actors) — that already-existing case becomes a 301 to the primary, removing an ambiguity the spec did not address.

---

## Rider — 2026-05-20 (M2 review: argument shape + multi-hop semantics + invariant compliance)

Three sub-decisions surfaced during the M2 milestone-plan multi-agent review. None alter the redirect contract committed above; this rider records the deltas so the M2 implementation (`admin-cli actors merge` in Epic N) has ratified text to cite.

### 1. `admin-cli actors merge` argument shape — addresses, not actor IDs

SPEC §6.20.1 specifies the command as `actor merge <primary_actor_id> <secondary_actor_id>` (UUIDs). Operator ergonomics favour addresses:

- Operators do not memorise internal UUIDs; they identify actors by on-chain address.
- Every other operator-facing reference to actors (URL paths, `admin-cli dlq` payloads, structured logs) uses addresses.
- The internal resolution `address → actor.id` is a single query against `actor_address` (the multi-address lookup table from §2.4.3) — the same query the actor-sweep path uses for derivation.

**Decision.** The command accepts addresses: `admin-cli actors merge <primary_address> <secondary_address>`. The CLI resolves both addresses to actor IDs in a single transaction before rewriting FKs. SPEC §6.20.1's actor-ID argument shape is superseded by this ADR for the `actors merge` command specifically; other CLI commands referenced in §6.20.1 are unaffected.

This is a substantive deviation from SPEC §6.20.1 and is recorded here per SPEC §8.4 (design changes flow through ADRs; the spec text itself remains unchanged at v1.0 baseline).

### 2. Multi-hop redirect semantics — flatten on merge, no chain-walking

The original Decision section (steps 1–4) does not address what happens when actor A merges into B and then B later merges into C. Two equivalent implementations were considered:

- **Chain-walk at request time.** API follows `actor_address_redirect` links transitively, returning 301 to the terminal survivor. Adds per-request work and a cycle-detection policy (the spec does not define one).
- **Flatten on merge.** When B merges into C, the merge transaction includes `UPDATE actor_address_redirect SET to_actor_id = C.id WHERE to_actor_id = B.id`. A's redirect row is updated in the same transaction.

**Decision.** Flatten on merge. The redirect lookup is O(1) at request time; no chain-walking, no cycle-detection policy needed (cycles are impossible by construction — survivors are always live actors, never merged-away ones). The merge transaction does one extra UPDATE per pre-existing redirect pointing at the secondary; in practice this is at most one or two rows.

### 3. SPEC §2.8 invariant 4 compliance — secondary actor preserved, not deleted

The original Decision section is silent on what happens to the secondary `actor` row after FKs are rewritten. SPEC §2.8 invariant 4 says actors are "mergeable, never deletable." A naive merge that DELETEs the secondary row violates the invariant.

**Decision.** The `actor` table gains a `merged_into_actor_id UUID NULL FK REFERENCES actor(id)` column (lands in M2's J1 migration `libs/db/migrations/0005_vote_delegation.ts`). On merge:

1. Rewrite FKs (`vote.voter_actor_id`, `delegation.{delegator,delegate}_actor_id`, `voting_power_snapshot.actor_id`, `proposal.proposer_actor_id`) from secondary to survivor.
2. Move secondary's `actor_address` rows under survivor (re-pointing `actor_id` FK; setting `is_primary=false` on the former-primary).
3. Insert `actor_address_redirect(from_address = secondary.primary_address, to_actor_id = survivor.id)`.
4. Flatten any existing redirects pointing at secondary (per §2 above).
5. `UPDATE actor SET merged_into_actor_id = survivor.id WHERE id = secondary.id` (preserves the row; marks it as merged-away).

The API redirect routing (Decision steps 1–4 above) gains a `WHERE merged_into_actor_id IS NULL` clause on step 1's `actor` lookup, so a query for the secondary's primary address falls through to step 2's redirect lookup as designed.

### Consequences additions

- New column `actor.merged_into_actor_id UUID NULL REFERENCES actor(id)`.
- Indexed: `CREATE INDEX idx_actor_merged_into ON actor(merged_into_actor_id) WHERE merged_into_actor_id IS NOT NULL` (small, only populated rows).
- `admin-cli actors merge` interface: `actors merge <primary_address> <secondary_address> [--dry-run] [--confirm] [--production]`.
- The redirect lookup remains O(1) regardless of merge history depth.
- §2.8 invariant 4 honoured: no actor row is ever DELETEd.
- The status flip is completed in M2/J1 alongside the core schema migration because the schema is the irreversible artifact that ratifies this ADR.

---

## Rider amendment — 2026-05-24 (`--reason` required on `admin-cli actors merge`)

M2's `admin-cli actors merge` implementation adds a required `--reason <text>` flag. This amendment ratifies that operator-interface choice for the redirect contract.

### Decision

`admin-cli actors merge <primary_address> <secondary_address>` now requires `--reason <text>`.

### Rationale

- `actor_address_redirect.merge_reason` is `NOT NULL`, so the merge transaction needs operator-provided rationale.
- The reason is written into `admin_audit.args` as part of the merge audit trail.
- A free-form reason makes later forensic review possible without out-of-band notes.

### Constraints

- The CLI rejects empty or whitespace-only reasons.
- The CLI caps `--reason` at 4 KiB to avoid bloating audit rows with pasted forum posts.
- This amendment only changes the operator interface for `actors merge`; the redirect routing contract above is unchanged.
