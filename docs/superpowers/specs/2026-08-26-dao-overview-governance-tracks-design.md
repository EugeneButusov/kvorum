# DAO overview: fold the governance-tracks panel into the header

Date: 2026-08-26
Status: approved, not yet implemented
Surface: `apps/dashboard` — `/daos/{slug}` overview, `/daos` directory

## Problem

The `GovernanceTracks` panel on the DAO overview page renders one card per
`dao_source.source_type`. That list is an **ingestion** list, not a governance list. On
`/daos/aave` it produces ten cards:

| source_type                          | what it is                                   |
| ------------------------------------ | -------------------------------------------- |
| `aave_governance_v3`                 | a real voting track                          |
| `aave_governance_v3_reconcile`       | internal reconciler                          |
| `aave_governor_v2`                   | a real, historical voting track              |
| `aave_governor_v2_reconcile`         | internal reconciler                          |
| `aave_payloads_controller`           | execution layer, not a vote                  |
| `aave_payloads_controller_reconcile` | internal reconciler                          |
| `aave_token`                         | token/delegation indexer                     |
| `aave_voting_machine`                | cross-chain tally component of Governance v3 |
| `discourse_forum`                    | forum ingestion                              |
| `snapshot`                           | a real off-chain signalling track            |

Three of ten are governance tracks. Nine of ten carry the generic fallback blurb
("A distinct governance track with its own voting-power semantics"), and `snapshot` carries
Lido-specific copy naming `lido-snapshot.eth` and LDO weighting — on the Aave page.

The panel is also the single largest block on the overview, pushing the health snapshot and
recent activity below the fold to say almost nothing.

The same raw list feeds `/daos` via `lib/daos/directory.ts`, where Aave lists ten "governors".

## Approach

Classify source types through a curated registry, and render the surviving tracks as a caption
line in the DAO header rather than a full-width panel. Delete the panel.

This moves the content from SPEC §6.6 item 6 ("Governance tracks" panel) into SPEC §6.6 item 1,
which already calls for a "governance summary (short prose)" in the header. §6.17's actual
commitment — parallel tracks surfaced explicitly, no unified voting-power figure anywhere — is
preserved: tracks are still named, and no unified figure is introduced.

`docs/SPEC.md` is frozen at v1.0 per `CLAUDE.md` and is **not** edited. The deviation is recorded
in a comment on `DaoHeader`.

## Design

### 1. `apps/dashboard/src/lib/dao/tracks.ts` — rewritten as a track registry

Replaces `trackDescription(sourceType)` with a classifier:

```ts
export type GovernanceTrack = {
  sourceType: string;
  label: string;
  description: string | null;
};

export function resolveTracks(sourceTypes: string[]): GovernanceTrack[];
```

Resolution order:

1. Dedupe. Input order is discarded — render order comes from the registry (step 4).
2. Drop any type matching a **structural suffix**: `_reconcile`, `_metadata`, `_meta`, `_token`.
   These name reconcilers, metadata enrichment, and token/delegation indexers — categories that
   are never governance tracks. A mechanical rule means a _new_ reconciler or metadata source
   never leaks into the UI without a code change.
3. Drop any type in the **explicit infrastructure set**: `aave_voting_machine`,
   `aave_payloads_controller`, `discourse_forum`.
4. Map surviving known types through the registry. Registry key order is render order.
5. Surviving **unknown** types are kept, labelled via `sourceLabel()`, `description: null`,
   appended after all known tracks and sorted alphabetically by label. A new governance family
   therefore appears on the page the day it is indexed, rather than silently vanishing.

Registry:

| source_type               | label                   | description (tooltip)                                                                                 |
| ------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `aragon_voting`           | Aragon voting           | Binding on-chain votes by LDO holders on the Aragon voting app.                                       |
| `dual_governance`         | Dual governance         | stETH-holder veto power over the Aragon timelock.                                                     |
| `easy_track`              | Easy Track              | Optimistic motions for routine, pre-approved operations.                                              |
| `aave_governance_v3`      | Governance v3           | Binding on-chain votes by AAVE, stkAAVE and aAAVE holders, tallied on the cross-chain voting machine. |
| `aave_governor_v2`        | Governor v2 (legacy)    | The pre-v3 on-chain governor, superseded by Governance v3. Retained for historical proposals.         |
| `compound_governor_bravo` | Governor Bravo          | Binding on-chain votes by COMP holders.                                                               |
| `compound_governor_alpha` | Governor Alpha (legacy) | The original COMP governor, superseded by Governor Bravo. Retained for historical proposals.          |
| `compound_governor_oz`    | Governor (OZ)           | OpenZeppelin Governor — binding on-chain token-holder votes.                                          |
| `snapshot`                | Snapshot                | Off-chain signalling — token-weighted and non-binding.                                                |

Notes on the registry:

- **Labels drop the DAO name.** `aave_governance_v3` is "Governance v3", not "Aave governance v3":
  the header sits directly under an `<h1>Aave</h1>`. `sourceLabel()` in
  `lib/proposals/source.ts` is **unchanged**, so proposal rows, cards, the homepage cross-DAO
  feed, and the health chart legend keep the DAO-qualified form they need. The divergence is
  deliberate and context-driven. The `/daos` directory (§4 below) also reuses the short labels,
  since each row is already titled with its DAO name.
- **Superseded governors carry a static `(legacy)` suffix.** Aave Governor v2 and Compound
  Governor Alpha accept no new proposals; listing them unmarked would assert they are a live way
  the DAO is governed. The marking is static registry data rather than derived from proposal
  recency, which would need a per-source_type query the page does not make today.
- **`aave_voting_machine` is hidden but named.** It is where AAVE votes are physically cast, so
  the Governance v3 description says so. It is not listed as its own track because it shares an
  electorate with Governance v3, and asserting two electorates where there is one is exactly what
  §6.17 exists to avoid.
- **`discourse_forum` is infrastructure.** A forum has no electorate and no voting-power
  semantics. The header already links out via `Forum ↗`, so the surface is not hidden from users,
  merely not miscategorised as a vote.
- The Aave and Compound descriptions are new copy written for this change and are open to
  rewording. The three Lido descriptions are the existing product copy, carried over verbatim
  except that `snapshot` is now DAO-agnostic.

### 2. `apps/dashboard/src/components/dao/dao-header.tsx`

Gains a `sourceTypes: string[]` prop. Renders a caption row on its own line between the
description and the existing `<dl>`:

```
Aave
Aave is a decentralized non-custodial liquidity protocol governed by AAVE token holders.
TRACKS Governance v3 · Governor v2 (legacy) · Snapshot
TOKEN 0x7fc6…dae9   Website ↗   Forum ↗
```

Markup, per §6.19 ("Lists are `<ul>`"):

```tsx
<div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-caption text-ink-3">
  <span id="dao-tracks-label" className="uppercase tracking-[0.04em] text-ink-4">
    Tracks
  </span>
  <ul aria-labelledby="dao-tracks-label" className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
    {tracks.map((track, i) => (
      <li key={track.sourceType} className="flex items-center gap-x-1.5">
        {i > 0 && (
          <span aria-hidden="true" className="text-ink-4">
            ·
          </span>
        )}
        <span className="text-ink-2" title={track.description ?? undefined}>
          {track.label}
        </span>
      </li>
    ))}
  </ul>
</div>
```

- Tracks are **plain text, not links**. The header already carries `Website ↗`, `Forum ↗`, and
  the Overview/Health/Proposals/Delegates sub-nav; three more links would make it link soup.
- The row is shown whenever `resolveTracks()` returns at least one track — including
  single-track DAOs such as Compound, which read `TRACKS Governor Bravo`. This differs from the
  old panel, which hid itself at `length <= 1`. A consistent header shape is worth more than
  suppressing a one-item list, and "what does Kvorum actually watch here?" is a useful answer
  even at n=1.
- The row is omitted entirely when `resolveTracks()` returns empty — which also covers the
  degraded path in `loadDao()`, where an unreachable API yields `sourceTypes: []`.

**Accepted limitation.** `title` is not keyboard-reachable. It is announced by screen readers as
the element's accessible description and revealed on pointer hover, and the label alone is
meaningful without it, so the tooltip is progressive enhancement rather than load-bearing
content. A keyboard-reachable popover is the answer if the blurbs later need to be load-bearing.

### 3. `apps/dashboard/src/app/(shell)/daos/[slug]/page.tsx`

Pass `sourceTypes={dao.sourceTypes}` to `DaoHeader`. Remove the `<GovernanceTracks …/>` render and
its import. No change to `loadDao()` — `DaoInfo.sourceTypes` already carries what is needed.

### 4. `apps/dashboard/src/lib/daos/directory.ts`

`fetchGovernors()` at line 38 maps the same raw list. Swap:

```ts
return data.data.map((s) => sourceLabel(s.source_type));
// →
return resolveTracks(data.data.map((s) => s.source_type)).map((t) => t.label);
```

Same root cause, same registry — and leaving it means `/daos` contradicts `/daos/aave` within one
session. Drops the now-unused `sourceLabel` import from this module.

### 5. Deletions

- `apps/dashboard/src/components/dao/governance-tracks.tsx`
- `apps/dashboard/src/components/dao/governance-tracks.test.tsx`

## Testing

`apps/dashboard/src/lib/dao/tracks.test.ts` — rewritten:

- Aave's full ten source types resolve to exactly `Governance v3`, `Governor v2 (legacy)`,
  `Snapshot`, in that order.
- Lido's four resolve to `Aragon voting`, `Dual governance`, `Easy Track`, `Snapshot`.
- Every `*_reconcile`, `*_metadata`, `*_meta`, `*_token` type is dropped.
- `aave_voting_machine`, `aave_payloads_controller`, `discourse_forum` are dropped.
- An unknown type (`mystery_governor`) survives with a `sourceLabel()` label, a `null`
  description, and sorts after all known tracks.
- Duplicate input types yield one entry.
- An all-infrastructure input yields `[]`.

`apps/dashboard/src/components/dao/dao-header.test.tsx` — new:

- Given Aave's ten source types, exactly three list items render.
- A known track exposes its description via `title`; an unknown track has no `title`.
- A single-track DAO still renders the row.
- `sourceTypes: []` renders no tracks row, and the token/links row is unaffected.

Existing `source.test.ts` is untouched, which is itself the assertion that `sourceLabel()` did not
change.

## Out of scope

- Deriving legacy/dormant status from proposal recency.
- Linking tracks to source-filtered proposal lists.
- Per-track metrics on the health dashboard (SPEC §6.7 / §6.17).
- Any change to the API — no `surface: 'track' | 'infrastructure'` field on `DaoSourceDto`. The
  classification lives in the dashboard for now; moving it into each `libs/sources/*` package is a
  reasonable later refactor if a second consumer needs it.
