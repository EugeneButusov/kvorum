# ADR-0089 — PostgreSQL full-text search for cross-entity keyword search

- **Status**: Accepted
- **Date**: 2026-08-27
- **Spec sections affected**: n/a (new capability, not covered by frozen v1.0 SPEC)
- **Related**: #629 (search epic), #630 (this ADR), #631–#634 (implementation subtasks)

## Context

Kvorum has no search infrastructure. The dashboard's top-nav `SearchBox` (`apps/dashboard/src/components/shell/search-box.tsx`) is a static placeholder ("Search proposals, addresses, txs…" + ⌘K badge) with no functionality. The API exposes no search endpoint. The database has no full-text-search columns or indexes. Users find content only by navigating listings, applying column filters, or following direct links.

Three entity types are navigational search targets:

| Entity       | Searchable fields                                  | Notes                                                        |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------ |
| **Proposal** | `title` (nullable text), `description` (text)      | Most searched entity — users look up proposals by keyword    |
| **DAO**      | `name` (text), `slug` (text), `description` (text) | Name/slug searches are near-exact; description is a fallback |
| **Actor**    | `display_name` (nullable text)                     | Address lookup is a separate code path (see below)           |

Address lookup is a distinct navigational pattern: users paste a hex address (e.g. `0x1234…`) to find an actor. This maps to an equality/prefix check against `actor_address.address`, not full-text search — addresses are opaque identifiers, not natural-language text.

Proposal-to-proposal similarity search already exists (`libs/ai/src/persistence/similar-proposals-repository.ts`) using pgvector cosine distance on `proposal_embedding`. That infrastructure is model-keyed (runs against pre-computed embeddings at a fixed `EMBEDDING_VERSION`), not user-query-driven, and is irrelevant to keyword search.

Data volume is modest: hundreds of DAOs, thousands of proposals, tens of thousands of actors. This is well within the comfortable range for PostgreSQL's built-in full-text search.

## Decision

### 1. Engine: PostgreSQL full-text search

Use PostgreSQL's built-in FTS (`tsvector` / `tsquery` / GIN indexes) rather than an external search engine.

- **No new infrastructure.** PG is already the primary store — no additional services to deploy, monitor, or pay for. The current DigitalOcean managed PG 18 instance handles this natively.
- **Transactional consistency.** Search index updates in the same transaction as writes — no replication lag, no eventual consistency, no sync jobs.
- **Adequate at this scale.** PG FTS handles hundreds of thousands of documents with single-digit-millisecond query latency under GIN indexes.
- **Expressible in Kysely.** The existing `sql` tagged-template helper cleanly wraps `tsvector` / `tsquery` / `ts_rank` operations; no ORM escape hatch needed.

### 2. Schema: generated tsvector columns with GIN indexes

Each searchable table gets a `search_vector` column defined as `GENERATED ALWAYS AS (…) STORED`:

```sql
-- proposal
ALTER TABLE proposal ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX idx_proposal_search ON proposal USING gin(search_vector);

-- dao
ALTER TABLE dao ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(slug, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX idx_dao_search ON dao USING gin(search_vector);

-- actor
ALTER TABLE actor ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(display_name, '')), 'A')
  ) STORED;

CREATE INDEX idx_actor_search ON actor USING gin(search_vector);
```

Generated columns (PG 12+) are preferred over triggers: zero application code, automatic sync on every `INSERT` / `UPDATE`, and simpler migrations. The trade-off — they cannot reference other tables — is acceptable because all searchable fields are same-row scalars.

The same migration installs `pg_trgm` (`CREATE EXTENSION IF NOT EXISTS pg_trgm`) for future fuzzy/typo-tolerant matching. It is not wired in v1.

### 3. Weighting strategy

`setweight` assigns A/B ranks per entity:

- **A** (weight 1.0): high-signal fields — proposal `title`, DAO `name`/`slug`, actor `display_name`.
- **B** (weight 0.4): supporting text — proposal `description`, DAO `description`.

This ensures a title match for "compound" ranks above a description-only mention. The four-tier system (A/B/C/D) leaves room for future fields (e.g. proposal `source_id`, forum content) at lower weights.

### 4. Query parsing

Use `websearch_to_tsquery('english', q)` for all user-typed queries. This handles:

- Multi-word queries as implicit AND (`compound governance` → `'compound' & 'govern'`)
- Quoted phrases (`"voting period"` → `'vote' <-> 'period'`)
- Exclusion (`compound -aave` → `'compound' & !'aav'`)
- Stemming (English configuration: "governance" matches "govern", "governing")

Fallback: if `websearch_to_tsquery` returns an empty tsquery (e.g. the input is all stop words), skip FTS and return empty results rather than a full table scan.

### 5. Ranking

Use `ts_rank_cd(search_vector, query)` (cover density ranking) per entity. The rank is returned as a `rank` field in each result item.

Cross-entity ordering is **not** server-side. The command palette groups results by category (Proposals / DAOs / Actors), each sorted by rank internally. The results page groups by tabs. There is no global interleaved ranking — FTS scores across different entity types are not directly comparable.

### 6. Address detection heuristic

If the query matches `/^0x[a-fA-F0-9]{4,40}$/i`, the search service performs a direct address lookup:

- **Full address** (40 hex chars after `0x`): exact equality against `actor_address.address` (lowercased).
- **Partial address** (4–39 hex chars after `0x`): prefix match via `LIKE 'q%'` on `actor_address.address`.

This runs **instead of** (not in addition to) FTS for the actor entity. Proposals and DAOs still run their FTS path — an address query is unlikely to match proposal text, but the cost is negligible and it avoids surprising omissions.

### 7. API contract

```
GET /v1/search?q=<query>&limit=<n>&type=<proposal|dao|actor>
```

Response shape:

```json
{
  "data": {
    "proposals": [
      {
        "id": "…",
        "dao_slug": "…",
        "source_type": "…",
        "source_id": "…",
        "title": "…",
        "state": "…",
        "rank": 0.85
      }
    ],
    "daos": [{ "id": "…", "slug": "…", "name": "…", "rank": 0.72 }],
    "actors": [{ "id": "…", "display_name": "…", "primary_address": "…", "rank": 0.91 }]
  }
}
```

- `q` is required; empty or whitespace-only returns 400.
- `type` is optional; when provided, only that entity's array is populated (the others are empty arrays).
- `limit` defaults to 5 per entity type (suitable for the command palette), max 25 (for the results page). Applies per entity, not globally.
- No cursor pagination in v1 — `limit` + `offset` suffices for FTS result sets at this scale. Offset defaults to 0.
- The endpoint lives at `apps/api/src/search/` (new module: controller + service + read repository).

### 8. Auth and rate limiting

The search endpoint is **not** public — the global `ApiKeyGuard` applies. This is consistent with all other data-read endpoints.

- Authenticated API consumers hit the `authenticated_free` tier (60/min, 10,000/day).
- Dashboard reads go through the BFF proxy (`apps/dashboard/src/app/api/[...path]/route.ts`), which attaches the internal read token — the same path as every other dashboard API call.
- No search-specific rate-limit tier is needed in v1. If abuse patterns emerge (high-frequency automated scraping via search), a dedicated tier can be added to `rate-limit.config.ts`.

### 9. Future: semantic search

Embedding the user's query and running cosine similarity against `proposal_embedding` is a natural v2 enhancement. It is out of scope for this epic:

- Adds per-query latency (an embedding API call before the DB query).
- Adds AI cost (proportional to query volume, not corpus size).
- Keyword FTS covers the primary navigational use cases.

The semantic path would complement, not replace, keyword FTS — a "hybrid search" where FTS results are re-ranked or augmented by embedding similarity.

## Alternatives considered

**Elasticsearch / Meilisearch / Typesense.** Full-featured search engines with richer capabilities (facets, typo tolerance, relevance tuning, highlighting). Rejected: the infrastructure cost (deployment, monitoring, data sync) is disproportionate to Kvorum's data volume. These become relevant if the corpus grows to millions of documents or if advanced features (faceted navigation, language-specific analysers) are needed.

**Trigger-maintained tsvector columns.** More flexible than generated columns: triggers can index computed fields, cross-table joins, or conditionally exclude rows. Rejected: generated columns are simpler (no trigger code, no deployment concerns around trigger ownership), and all searchable fields are same-row scalars. If cross-table indexing is needed later (e.g. indexing DAO name into proposal search), a trigger-based approach can be adopted for that specific table.

**Extending the query-descriptor framework.** The existing `EndpointQuery` / `FilterOperator` system (`'eq' | 'in' | 'gte' | 'lte'`) could be extended with a text-search operator. Rejected: FTS is structurally different from column filters — it involves ranking, multi-entity fan-out, special query parsing, and address detection. Forcing it into the filter framework would complicate both systems. A dedicated `/v1/search` endpoint is a cleaner contract.

**Unauthenticated (`@Public()`) search.** Would allow search without an API key, reducing friction for anonymous dashboard visitors. Rejected: all data-read endpoints currently require an API key. Making search the exception is inconsistent and removes the per-key rate-limit protection. The dashboard's BFF proxy already handles authentication transparently.

## Consequences

### Positive

- Zero new infrastructure — search runs in the existing PG instance with no additional services.
- Transactional consistency — search indexes update atomically with writes, no replication lag.
- Generated columns are zero-maintenance — no trigger code to manage, no application-level sync.
- `pg_trgm` is pre-installed, providing a clear upgrade path to fuzzy/typo-tolerant matching.
- The dedicated `/v1/search` endpoint is a clean, self-contained contract that doesn't complicate existing list endpoints.

### Negative / risks

- **Storage overhead.** `GENERATED ALWAYS AS` tsvector columns add ~100–500 bytes per row depending on text length. Negligible at current scale (thousands of rows), but worth monitoring if the corpus grows by orders of magnitude.
- **English-only stemming.** The `'english'` text search configuration provides English stemming and stop-word removal. Non-English proposal titles and descriptions will have degraded search quality (no stemming, stop words not removed). Acceptable for v1; a per-DAO language configuration is a future enhancement.
- **Generated columns cannot reference other tables.** Actor address search requires a separate equality/prefix code path rather than being part of the FTS column. This is a minor implementation complexity, not an architectural limitation.

### Neutral

- The `search_vector` columns are not added to the Kysely `PgDatabase` type — they are internal to PG and accessed only via `sql` tag queries. This matches the existing pattern where raw SQL columns (e.g. in pgvector operations) bypass the typed schema.
- The multi-entity response shape (`{ proposals, daos, actors }`) differs from the standard list response (`{ data: [...], pagination }`) — this is intentional, as search is a different kind of query.
