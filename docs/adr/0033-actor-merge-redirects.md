# ADR-033 — Actor merge produces HTTP 301 redirects on canonical URLs

- **Status**: Proposed
- **Date**: 2026-05-08
- **Spec sections affected**: 2.4.3, 4.2, 6.10
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
