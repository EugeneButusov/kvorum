# ADR-030 — Per-source title extraction rules

- **Status**: Accepted
- **Date**: 2026-05-08
- **Spec sections affected**: 2.4.4

## Context

SPEC §2.4.4 specifies `proposal.title` as "extracted from description, nullable if unparseable." The spec leaves the extraction logic unspecified. In practice every source presents the title differently:

- **Compound** Governor proposals are submitted with a description string; convention places the title as the first line, often prefixed with `# `, but this is not enforced and some proposals omit it.
- **Aave** Governance v3 stores an on-chain `bytes32 ipfsHash`; title and description are fetched from the referenced IPFS metadata JSON.
- **Aragon** proposals carry a `metadata` field; Lido's Aragon votes typically populate it with `{title, description}` JSON, but legacy votes may not.
- **Snapshot** proposals have an explicit `title` field that is always populated.
- **Dual Governance** proposals do not have their own title — they are veto signaling on Aragon proposals; the originating Aragon proposal's title is what the user expects.

Without per-source rules, extraction is inconsistent and the dashboard ends up doing string-munging at display time, which doesn't help API consumers.

## Decision

Per-source title extraction, applied at proposal-ingestion time and stored in `proposal.title`:

| `source_type`             | Extraction rule                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compound_governor_bravo` | First non-empty line of `description`, stripped of leading `#` characters and whitespace; truncated to 200 chars with `…` if longer; NULL if `description` is empty.                                    |
| `aave_governance_v3`      | `title` from IPFS metadata JSON if present; else first non-empty line of IPFS `description`, stripped of leading `#` and whitespace; else placeholder `Proposal #{proposalId}` when IPFS is unresolved. |
| `aragon_voting`           | `metadata.title` if present; else first non-empty line of `metadata.description` with the same `#`-stripping; else NULL.                                                                                |
| `snapshot`                | The Snapshot API's `title` field, taken as-is, truncated to 200 chars with `…` if longer.                                                                                                               |
| `dual_governance`         | The originating Aragon proposal's title, looked up via the DG state's link to the affected Aragon proposal. NULL if no Aragon proposal is linked.                                                       |

The extractors are small unit-tested functions in source-local implementations:

- Compound: `libs/sources/compound/src/governor/domain/title-extractor.ts`
- Aave: `libs/sources/aave/src/governance-v3/domain/title-extractor.ts`

Each rule has at least three test fixtures: a typical proposal, an edge case (empty description, missing metadata), and a known-historical example.

The truncation marker is the Unicode ellipsis (`…`, U+2026), not three ASCII dots, so consumers can detect truncation programmatically. The full text is always available in `proposal.description`.

## Alternatives considered

- **AI-based title extraction.** Overengineered for a deterministic problem. Adds cost, latency, and a failure mode for what is essentially "read the first line."
- **Always NULL; let the dashboard render `description`'s first line at display time.** Pushes the same logic into the dashboard layer and breaks API consumers who reasonably expect a `title` field.
- **A single rule across all sources** (e.g., always first line of description). Wrong for Snapshot (which has explicit titles) and Aragon (which uses structured metadata).

## Consequences

- The title field is reliable across all v1 DAOs.
- Adding a fourth DAO post-v1 means adding one row to the extractor table.
- Title is computed at ingestion, not on read — simple, cacheable, fast.
- For `aave_governance_v3`, `proposal.description_hash` stores the canonical on-chain IPFS digest (64 hex chars, no `0x`) and remains immutable even after title/description enrichment succeeds.
- The dashboard's proposal-list rows display titles consistently; truncation is uniform; no per-source string handling on the frontend.
- §2.4.4's field description is updated to reference this ADR for the precise extraction rules.
