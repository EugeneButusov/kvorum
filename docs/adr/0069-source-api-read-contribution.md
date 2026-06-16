# ADR-0069 — Source API read-contribution contract

**Status:** Accepted
**Date:** 2026-06-16
**Deciders:** Eugene
**Cross-refs:** Amends ADR-0057 (adds read-side sibling); resolves ADR-0067 "API surfacing of `voting_chain_id` deferred to Epic T" (lands in M3 X1)

---

## Context

The proposal-detail endpoint must render Aave-specific data (voting metadata, payload statuses per chain). `apps/api` must stay source-blind: it depends on no source package, the extension table types live in `libs/sources/aave` via `declare module '@libs/db'` (invisible to the API's compilation), and `SOURCE_PLUGINS` drags ingestion. So sources must contribute read capability through a light contract the API consults.

This mirrors ADR-0057's ingestion-side `SourcePlugin` on the read side. The same mechanism serves M4 (Lido adds four more extension tables) — the API stays source-blind while new source packages contribute their own read adapters.

## Decision

Sources contribute read-side API capabilities through a dependency-free `SourceApiContribution` interface hosted in `@libs/domain`. The interface is aggregated by a new `@nest/source-api` package and consumed by a source-blind `apps/api`.

### The contract (`@libs/domain`)

```ts
export interface ChoiceBounds {
  min: number;
  max: number;
}
export interface ProposalExtension {
  voting: ProposalVotingView | null;
  payloads: readonly ProposalPayloadView[];
}
export interface SourceApiContribution {
  readonly sourceTypes: readonly string[];
  choiceBounds(sourceType: string): ChoiceBounds;
  getProposalExtension(proposalId: string, sourceType: string): Promise<ProposalExtension | null>;
}
```

`getProposalExtension` captures its DB handle at construction, so the interface references no Kysely/PG type and is safe in zero-dep `@libs/domain`. `@sources/core` re-exports for discovery.

### Scope guard

**Proposal-level read extensions only.** Vote/delegation/actor extension surfaces are out of scope and would each require their own decision — no god-registry.

### Per-source contributions

- **`@sources/compound/api`** — `compoundApiContribution`: `sourceTypes` = three Compound governor types; `choiceBounds → {min:0,max:2}`; `getProposalExtension → null`.
- **`@sources/aave/api`** — `makeAaveApiContribution()`: `sourceTypes` = four Aave types; `choiceBounds → {min:0,max:1}`; `getProposalExtension` reads via `AaveProposalExtensionReadRepository` (implemented in PR2).

Each `api/` file imports only `kysely` + the source's schema types + choice constants — no ABI/ethers/ingestion.

The new read repo **must** `import './schema'` as a side-effect so the `declare module '@libs/db'` augmentation makes `aave_proposal_*` resolvable on `Kysely<PgDatabase>`.

### Registry (`@nest/source-api`)

`SourceApiRegistry` builds `Map<sourceType, SourceApiContribution>` once (singleton); exposes `choiceBounds(sourceType)` (wide default `{min:0,max:2}` if unknown — never 500s) and `getProposalExtension(proposalId, sourceType)`. `apps/api` imports `SourceApiModule`, injects `SourceApiRegistry` into `VotesController` + `ProposalController`.

### Bundle-hygiene control (Risk R1)

`apps/api/webpack.config.js` externalizes any import not `@libs/`/`@nest/`. The enforced controls:

1. **Webpack alias**: `'@sources/aave/api'` and `'@sources/compound/api'` aliased to their light entry files.
2. **Externals allowlist**: these two subpaths are explicitly **not** externalized (barrels stay external).
3. **tsconfig.base.json paths**: entries for `@sources/{aave,compound}/api` and `@nest/source-api`.
4. **ESLint `no-restricted-imports`** in `apps/api/src` banning `@sources/*`; in `nest/source-api/src` banning the heavy barrels.
5. **Bundle gate**: `! grep -q "ethers" dist/apps/api/main.js` in CI and PR acceptance.

### Dependency direction

```
apps/api ──▶ @nest/source-api ──▶ @sources/aave/api  ──▶ kysely + schema types  (NO ethers)
        │                     └─▶ @sources/compound/api
        └──▶ @libs/domain (ProposalExtension, ChoiceBounds, SourceApiContribution)
```

## Consequences

- `apps/api` remains source-blind — ESLint-enforced via `no-restricted-imports`.
- New sources (e.g. Lido in M4) add an `api/` entry + register with `SourceApiModule`; no API code changes required.
- The interface is **additive-only**: `getProposalExtension` returns `null` for sources with no extension; the proposal endpoint omits `voting`/`payloads` when null.
- The wide default in `choiceBounds` means unknown source types are never rejected by the semantic guard — they fall back to the broadest valid range.
