# DAO Header Governance Tracks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-width `GovernanceTracks` panel on `/daos/{slug}` with a one-line tracks caption in the DAO header, driven by a curated registry that separates real governance tracks from ingestion plumbing.

**Architecture:** A new pure classifier in `apps/dashboard/src/lib/dao/tracks.ts` turns a raw `source_type[]` into an ordered `GovernanceTrack[]`, dropping reconcilers/metadata/token indexers by suffix and track machinery by an explicit set. `DaoHeader` consumes it and renders a `<ul>` caption row; the panel component and its test are deleted; `lib/daos/directory.ts` reuses the same classifier so `/daos` stops listing ten "governors" for Aave.

**Tech Stack:** Next.js 16 App Router, React 19 server components, TypeScript 5.7 (strict + `noUncheckedIndexedAccess`), Vitest 4 + `@testing-library/react` + `jest-dom` + `vitest-axe`, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-26-dao-overview-governance-tracks-design.md`

## Global Constraints

- Every commit must pass: `pnpm -w format:check`, `pnpm -w lint`, `pnpm -w typecheck`, `pnpm -w test`. Never use `--no-verify`.
- Conventional Commits for commit messages: `<type>(<scope>): <imperative description>`.
- TypeScript is `strict` with `noUncheckedIndexedAccess`. Indexing a `Record` yields `T | undefined` — narrow explicitly, do not use `!`.
- `docs/SPEC.md` is frozen at v1.0 and MUST NOT be edited. The §6.6 deviation is recorded as a code comment on `DaoHeader` only.
- `sourceLabel()` in `apps/dashboard/src/lib/proposals/source.ts` MUST NOT change. Proposal rows, cards, the cross-DAO homepage feed, and the health chart legend depend on its DAO-qualified output. The registry's short labels are a separate, header-only concern.
- Track labels in the registry omit the DAO name (`Governance v3`, not `Aave governance v3`).
- Superseded governors carry a static `(legacy)` suffix in their label. Do not derive this from proposal recency.
- Run dashboard tests from the repo root as `pnpm --filter dashboard test <path>`.

## File Structure

| File                                                           | Responsibility                                                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/lib/dao/tracks.ts`                         | **Rewritten.** Registry + `resolveTracks()`. Pure, no React. Sole owner of "which source_types are governance tracks". |
| `apps/dashboard/src/lib/dao/tracks.test.ts`                    | **Rewritten.** Classifier behaviour.                                                                                   |
| `apps/dashboard/src/components/dao/dao-header.tsx`             | **Modified.** Gains `sourceTypes`, renders the tracks row.                                                             |
| `apps/dashboard/src/components/dao/dao-header.test.tsx`        | **Created.** Header rendering of tracks.                                                                               |
| `apps/dashboard/src/components/a11y.test.tsx`                  | **Modified.** One more §6.19 axe case for the new markup.                                                              |
| `apps/dashboard/src/app/(shell)/daos/[slug]/page.tsx`          | **Modified.** Passes `sourceTypes`; drops the panel.                                                                   |
| `apps/dashboard/src/components/dao/governance-tracks.tsx`      | **Deleted.**                                                                                                           |
| `apps/dashboard/src/components/dao/governance-tracks.test.tsx` | **Deleted.**                                                                                                           |
| `apps/dashboard/src/lib/daos/directory.ts`                     | **Modified.** `fetchGovernors()` reuses `resolveTracks()`.                                                             |

**Task ordering note:** Task 2 makes `sourceTypes` a required prop on `DaoHeader`, so it also adds the one-line call-site update in `page.tsx` to keep `typecheck` green. Task 3 then removes the panel. The commit after Task 2 briefly renders both the header row and the panel — that is a valid, green intermediate state.

---

### Task 1: Governance track registry

**Files:**

- Modify (full rewrite): `apps/dashboard/src/lib/dao/tracks.ts`
- Test (full rewrite): `apps/dashboard/src/lib/dao/tracks.test.ts`

**Interfaces:**

- Consumes: `sourceLabel(sourceType: string): string` from `@/lib/proposals/source` — turns `aragon_voting` into `Aragon voting`.
- Produces:
  - `export type GovernanceTrack = { sourceType: string; label: string; description: string | null }`
  - `export function resolveTracks(sourceTypes: string[]): GovernanceTrack[]`
  - The old export `trackDescription(sourceType: string): string` is **removed**. Its only caller is `governance-tracks.tsx`, deleted in Task 3.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `apps/dashboard/src/lib/dao/tracks.test.ts` with:

```ts
import { resolveTracks } from './tracks';

// Exactly what dao_source carries for Aave today: three governance tracks and seven pieces of
// ingestion plumbing. This list is the whole reason the module exists.
const AAVE_SOURCE_TYPES = [
  'aave_governance_v3',
  'aave_governance_v3_reconcile',
  'aave_governor_v2',
  'aave_governor_v2_reconcile',
  'aave_payloads_controller',
  'aave_payloads_controller_reconcile',
  'aave_token',
  'aave_voting_machine',
  'discourse_forum',
  'snapshot',
];

describe('resolveTracks', () => {
  it("reduces Aave's ten source types to its three real tracks, in registry order", () => {
    expect(resolveTracks(AAVE_SOURCE_TYPES).map((t) => t.label)).toEqual([
      'Governance v3',
      'Governor v2 (legacy)',
      'Snapshot',
    ]);
  });

  it('keeps every Lido track and orders binding votes before signalling (§6.17)', () => {
    const tracks = resolveTracks([
      'snapshot',
      'easy_track',
      'aragon_voting',
      'dual_governance',
      'aragon_voting_reconcile',
      'aragon_proposal_metadata',
    ]);
    expect(tracks.map((t) => t.label)).toEqual([
      'Aragon voting',
      'Dual governance',
      'Easy Track',
      'Snapshot',
    ]);
    expect(tracks.find((t) => t.sourceType === 'dual_governance')?.description).toMatch(/stETH/);
  });

  it('no longer describes Snapshot in Lido-specific terms', () => {
    const snapshot = resolveTracks(['snapshot'])[0];
    expect(snapshot?.description).not.toMatch(/lido|LDO/i);
  });

  it('drops reconcilers, metadata enrichers and token indexers by suffix', () => {
    expect(
      resolveTracks([
        'compound_governor_bravo_reconcile',
        'aragon_proposal_metadata',
        'compound_proposal_meta',
        'compound_comp_token',
      ]),
    ).toEqual([]);
  });

  it('drops track machinery that shares an electorate or holds no vote', () => {
    expect(
      resolveTracks(['aave_voting_machine', 'aave_payloads_controller', 'discourse_forum']),
    ).toEqual([]);
  });

  it('keeps an unrecognised source type, undescribed and after the known ones', () => {
    expect(resolveTracks(['mystery_governor', 'snapshot'])).toEqual([
      { sourceType: 'snapshot', label: 'Snapshot', description: expect.any(String) },
      { sourceType: 'mystery_governor', label: 'Mystery governor', description: null },
    ]);
  });

  it('sorts multiple unrecognised types alphabetically by label', () => {
    expect(resolveTracks(['zebra_governor', 'alpaca_governor']).map((t) => t.label)).toEqual([
      'Alpaca governor',
      'Zebra governor',
    ]);
  });

  it('dedupes repeated source types', () => {
    expect(resolveTracks(['snapshot', 'snapshot']).map((t) => t.sourceType)).toEqual(['snapshot']);
  });

  it('returns nothing for a DAO whose sources are all infrastructure', () => {
    expect(resolveTracks(['aave_token', 'discourse_forum'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter dashboard test src/lib/dao/tracks.test.ts
```

Expected: FAIL. `tracks.ts` still exports only `trackDescription`, so the import of `resolveTracks` is undefined — every case errors with `resolveTracks is not a function`.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `apps/dashboard/src/lib/dao/tracks.ts` with:

```ts
// Governance-track registry (§6.6 §1, §6.17, DR-011). `dao_source.source_type` is an *ingestion*
// list: reconcilers, metadata enrichers, token indexers and execution contracts sit alongside the
// handful of types that are genuinely ways a DAO decides things (Aave has ten rows and three
// tracks). This module is the classifier that separates the two, so the UI can name governance
// tracks without reciting plumbing.
// See docs/superpowers/specs/2026-08-26-dao-overview-governance-tracks-design.md.

import { sourceLabel } from '@/lib/proposals/source';

export type GovernanceTrack = {
  sourceType: string;
  label: string;
  /** The track's electorate and semantics in one line; null for a type we don't recognise. */
  description: string | null;
};

/**
 * Recognised governance tracks. Key order is render order — binding on-chain votes first, then
 * superseded governors, then off-chain signalling.
 *
 * Labels deliberately omit the DAO name: these render under the DAO's own <h1>, unlike
 * `sourceLabel()`, which serves cross-DAO surfaces and must stay qualified.
 */
const TRACK_REGISTRY: Record<string, { label: string; description: string }> = {
  aragon_voting: {
    label: 'Aragon voting',
    description: 'Binding on-chain votes by LDO holders on the Aragon voting app.',
  },
  dual_governance: {
    label: 'Dual governance',
    description: 'stETH-holder veto power over the Aragon timelock.',
  },
  easy_track: {
    label: 'Easy Track',
    description: 'Optimistic motions for routine, pre-approved operations.',
  },
  aave_governance_v3: {
    label: 'Governance v3',
    description:
      'Binding on-chain votes by AAVE, stkAAVE and aAAVE holders, tallied on the cross-chain voting machine.',
  },
  aave_governor_v2: {
    label: 'Governor v2 (legacy)',
    description:
      'The pre-v3 on-chain governor, superseded by Governance v3. Retained for historical proposals.',
  },
  compound_governor_bravo: {
    label: 'Governor Bravo',
    description: 'Binding on-chain votes by COMP holders.',
  },
  compound_governor_alpha: {
    label: 'Governor Alpha (legacy)',
    description:
      'The original COMP governor, superseded by Governor Bravo. Retained for historical proposals.',
  },
  compound_governor_oz: {
    label: 'Governor (OZ)',
    description: 'OpenZeppelin Governor — binding on-chain token-holder votes.',
  },
  snapshot: {
    label: 'Snapshot',
    description: 'Off-chain signalling — token-weighted and non-binding.',
  },
};

/**
 * Suffixes that never name a governance track: reconcilers, metadata enrichers, and
 * token/delegation indexers. A structural rule rather than a list means a *new* source of these
 * kinds cannot leak into the UI without someone changing code.
 */
const INFRASTRUCTURE_SUFFIXES = ['_reconcile', '_metadata', '_meta', '_token'];

/** Indexed contracts that are a track's machinery rather than a track in their own right. */
const INFRASTRUCTURE_TYPES = new Set([
  // Where Governance v3 votes are physically cast. Same electorate as v3, so listing it separately
  // would assert two electorates where there is one — precisely what §6.17 exists to avoid.
  'aave_voting_machine',
  // Execution layer: runs a payload once a vote has passed, never holds one.
  'aave_payloads_controller',
  // Discussion, not a vote: no electorate, no voting-power semantics. The header links out to it.
  'discourse_forum',
]);

function isInfrastructure(sourceType: string): boolean {
  return (
    INFRASTRUCTURE_TYPES.has(sourceType) ||
    INFRASTRUCTURE_SUFFIXES.some((suffix) => sourceType.endsWith(suffix))
  );
}

/**
 * The user-facing governance tracks behind a DAO's `source_type` list: recognised tracks in
 * registry order, then unrecognised ones alphabetically. Unrecognised types are kept rather than
 * dropped so a newly indexed governance family surfaces the day it lands; they carry no description
 * because we have nothing honest to say about them yet.
 */
export function resolveTracks(sourceTypes: string[]): GovernanceTrack[] {
  const candidates = [...new Set(sourceTypes)].filter((s) => !isInfrastructure(s));

  const known: GovernanceTrack[] = [];
  for (const sourceType of Object.keys(TRACK_REGISTRY)) {
    if (!candidates.includes(sourceType)) continue;
    const entry = TRACK_REGISTRY[sourceType];
    if (!entry) continue;
    known.push({ sourceType, label: entry.label, description: entry.description });
  }

  const unknown: GovernanceTrack[] = candidates
    .filter((s) => !(s in TRACK_REGISTRY))
    .map((sourceType) => ({ sourceType, label: sourceLabel(sourceType), description: null }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [...known, ...unknown];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter dashboard test src/lib/dao/tracks.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Confirm `sourceLabel()` was not disturbed**

```bash
pnpm --filter dashboard test src/lib/proposals/source.test.ts
```

Expected: PASS. This suite is the guard on the Global Constraint that `sourceLabel()` keeps its DAO-qualified output.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/lib/dao/tracks.ts apps/dashboard/src/lib/dao/tracks.test.ts
git commit -m "feat(dashboard): classify source types into user-facing governance tracks"
```

---

### Task 2: Tracks row in the DAO header

**Files:**

- Modify: `apps/dashboard/src/components/dao/dao-header.tsx`
- Modify: `apps/dashboard/src/app/(shell)/daos/[slug]/page.tsx:95-101` (add the prop only — the panel stays until Task 3)
- Modify: `apps/dashboard/src/components/a11y.test.tsx`
- Test (create): `apps/dashboard/src/components/dao/dao-header.test.tsx`

**Interfaces:**

- Consumes: `resolveTracks(sourceTypes: string[]): GovernanceTrack[]` and `type GovernanceTrack = { sourceType: string; label: string; description: string | null }` from `@/lib/dao/tracks` (Task 1).
- Produces: `DaoHeader` gains a **required** prop `sourceTypes: string[]`. Full prop list after this task: `{ name: string; description: string; tokenAddress: string; websiteUrl?: string; forumUrl?: string; sourceTypes: string[] }`.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/dao/dao-header.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';

import { DaoHeader } from './dao-header';

const AAVE_SOURCE_TYPES = [
  'aave_governance_v3',
  'aave_governance_v3_reconcile',
  'aave_governor_v2',
  'aave_governor_v2_reconcile',
  'aave_payloads_controller',
  'aave_payloads_controller_reconcile',
  'aave_token',
  'aave_voting_machine',
  'discourse_forum',
  'snapshot',
];

function renderHeader(sourceTypes: string[]) {
  return render(
    <DaoHeader
      name="Aave"
      description="Aave is a decentralized non-custodial liquidity protocol."
      tokenAddress="0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9"
      websiteUrl="https://aave.com"
      forumUrl="https://governance.aave.com"
      sourceTypes={sourceTypes}
    />,
  );
}

describe('DaoHeader', () => {
  it('names only the real governance tracks, not the ingestion plumbing', () => {
    renderHeader(AAVE_SOURCE_TYPES);
    const tracks = screen.getByRole('list', { name: 'Tracks' });
    expect(within(tracks).getAllByRole('listitem')).toHaveLength(3);
    expect(tracks).toHaveTextContent('Governance v3');
    expect(tracks).toHaveTextContent('Governor v2 (legacy)');
    expect(tracks).toHaveTextContent('Snapshot');
    expect(tracks).not.toHaveTextContent(/reconcile/i);
    expect(tracks).not.toHaveTextContent(/voting machine/i);
  });

  it('explains a recognised track on hover and stays silent on an unrecognised one', () => {
    renderHeader(['aave_governance_v3', 'mystery_governor']);
    expect(screen.getByText('Governance v3').getAttribute('title')).toMatch(/AAVE/);
    expect(screen.getByText('Mystery governor')).not.toHaveAttribute('title');
  });

  it('still names a single-track DAO', () => {
    renderHeader(['compound_governor_bravo', 'compound_comp_token']);
    expect(screen.getByRole('list', { name: 'Tracks' })).toHaveTextContent('Governor Bravo');
  });

  it('omits the tracks row when there is nothing to name, keeping token and links', () => {
    renderHeader([]);
    expect(screen.queryByRole('list', { name: 'Tracks' })).not.toBeInTheDocument();
    expect(screen.getByText('0x7fc6…dae9')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Website/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter dashboard test src/components/dao/dao-header.test.tsx
```

Expected: FAIL. `DaoHeader` ignores `sourceTypes` and renders no list, so `getByRole('list', { name: 'Tracks' })` throws `Unable to find an accessible element with the role "list"`.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `apps/dashboard/src/components/dao/dao-header.tsx` with:

```tsx
import { resolveTracks } from '@/lib/dao/tracks';
import { truncateAddress } from '@/lib/format';

/**
 * DAO header (§6.6 §1): name, description, governance tracks, primary token, and external links.
 *
 * The tracks line is the "governance summary (short prose)" of §6.6 §1 and takes over from the
 * standalone Governance tracks panel of §6.6 §6. §6.17's commitments survive the move: parallel
 * tracks are still surfaced explicitly, and no unified voting-power figure is introduced anywhere.
 * SPEC.md is frozen at v1.0, so the deviation is recorded here rather than there.
 *
 * Track blurbs ride on `title`, which is not keyboard-reachable. That is deliberate: the label
 * alone is meaningful, so the blurb is progressive enhancement rather than load-bearing content.
 */
export function DaoHeader({
  name,
  description,
  tokenAddress,
  websiteUrl,
  forumUrl,
  sourceTypes,
}: {
  name: string;
  description: string;
  tokenAddress: string;
  websiteUrl?: string;
  forumUrl?: string;
  sourceTypes: string[];
}) {
  const tracks = resolveTracks(sourceTypes);

  return (
    <header className="flex flex-col gap-3 border-b border-line-2 pb-6">
      <h1 className="text-h1 font-semibold text-ink">{name}</h1>
      {description && <p className="max-w-2xl text-body-lg text-ink-2">{description}</p>}
      {tracks.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-caption text-ink-3">
          <span id="dao-tracks-label" className="uppercase tracking-[0.04em] text-ink-4">
            Tracks
          </span>
          <ul
            aria-labelledby="dao-tracks-label"
            className="flex flex-wrap items-center gap-x-1.5 gap-y-1"
          >
            {tracks.map((track, index) => (
              <li key={track.sourceType} className="flex items-center gap-x-1.5">
                {index > 0 && (
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
      )}
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-caption text-ink-3">
        {tokenAddress && (
          <div className="flex items-center gap-2">
            <dt className="uppercase tracking-[0.04em] text-ink-4">Token</dt>
            <dd className="text-ink-2">{truncateAddress(tokenAddress)}</dd>
          </div>
        )}
        {websiteUrl && (
          <a href={websiteUrl} className="text-ink-2 hover:text-ink" rel="noreferrer noopener">
            Website ↗
          </a>
        )}
        {forumUrl && (
          <a href={forumUrl} className="text-ink-2 hover:text-ink" rel="noreferrer noopener">
            Forum ↗
          </a>
        )}
      </dl>
    </header>
  );
}
```

- [ ] **Step 4: Keep the call site compiling**

In `apps/dashboard/src/app/(shell)/daos/[slug]/page.tsx`, add one line to the existing `<DaoHeader …/>` so the now-required prop is supplied. The `<GovernanceTracks …/>` render at line 116 stays for now — Task 3 removes it.

```tsx
<DaoHeader
  name={dao.name}
  description={dao.description}
  tokenAddress={dao.tokenAddress}
  websiteUrl={dao.websiteUrl}
  forumUrl={dao.forumUrl}
  sourceTypes={dao.sourceTypes}
/>
```

- [ ] **Step 5: Add the §6.19 axe case**

In `apps/dashboard/src/components/a11y.test.tsx`, add this import alongside the existing ones (keep them alphabetically grouped — it belongs directly after the `./charts/figure` import):

```tsx
import { DaoHeader } from './dao/dao-header';
```

and add this case inside the `describe('accessibility (axe) — §6.19', …)` block, after the `data table` case:

```tsx
it('the DAO header, tracks row included, has no violations', async () => {
  // The tracks list is named by a sibling span via aria-labelledby — exactly the wiring axe
  // catches when it goes wrong.
  await expectNoViolations(
    <DaoHeader
      name="Aave"
      description="Aave is a decentralized non-custodial liquidity protocol."
      tokenAddress="0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9"
      websiteUrl="https://aave.com"
      forumUrl="https://governance.aave.com"
      sourceTypes={['aave_governance_v3', 'aave_governor_v2', 'snapshot']}
    />,
  );
});
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm --filter dashboard test src/components/dao/dao-header.test.tsx src/components/a11y.test.tsx
```

Expected: PASS — 4 `DaoHeader` tests and 12 accessibility tests (11 existing plus the new one).

- [ ] **Step 7: Typecheck the changed call site**

```bash
pnpm -w typecheck
```

Expected: exit 0. If `page.tsx` reports `Property 'sourceTypes' is missing`, Step 4 was not applied.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/components/dao/dao-header.tsx apps/dashboard/src/components/dao/dao-header.test.tsx apps/dashboard/src/components/a11y.test.tsx "apps/dashboard/src/app/(shell)/daos/[slug]/page.tsx"
git commit -m "feat(dashboard): name a DAO's governance tracks in its header"
```

---

### Task 3: Retire the governance-tracks panel

**Files:**

- Modify: `apps/dashboard/src/app/(shell)/daos/[slug]/page.tsx` (remove import at line 4, remove render at line 116)
- Delete: `apps/dashboard/src/components/dao/governance-tracks.tsx`
- Delete: `apps/dashboard/src/components/dao/governance-tracks.test.tsx`

**Interfaces:**

- Consumes: the `sourceTypes` prop wiring added to `page.tsx` in Task 2.
- Produces: nothing new. `GovernanceTracks` and `trackDescription` cease to exist; nothing may import them afterwards.

- [ ] **Step 1: Delete the panel and its test**

```bash
git rm apps/dashboard/src/components/dao/governance-tracks.tsx apps/dashboard/src/components/dao/governance-tracks.test.tsx
```

- [ ] **Step 2: Remove the import from the page**

In `apps/dashboard/src/app/(shell)/daos/[slug]/page.tsx`, delete line 4:

```tsx
import { GovernanceTracks } from '@/components/dao/governance-tracks';
```

- [ ] **Step 3: Remove the render from the page**

In the same file, delete the `<GovernanceTracks …/>` line and the blank line that follows it, so the "Active proposals" `</section>` is followed directly by the health/delegates grid:

```tsx
      </section>

      <div className="grid gap-10 lg:grid-cols-2">
```

- [ ] **Step 4: Verify nothing still references the deleted module**

```bash
grep -rn "GovernanceTracks\|governance-tracks\|trackDescription" apps/dashboard/src
```

Expected: no output. Any hit is a dangling reference to fix before continuing.

- [ ] **Step 5: Run the full dashboard suite**

```bash
pnpm --filter dashboard test
```

Expected: PASS. The three deleted `GovernanceTracks` cases are gone; nothing else regresses.

- [ ] **Step 6: Commit**

```bash
git add -A "apps/dashboard/src/app/(shell)/daos/[slug]/page.tsx" apps/dashboard/src/components/dao/
git commit -m "refactor(dashboard): drop the governance-tracks panel from the DAO overview"
```

---

### Task 4: Stop the DAO directory listing plumbing as governors

**Files:**

- Modify: `apps/dashboard/src/lib/daos/directory.ts:8` (import) and `:32-41` (`fetchGovernors`)

**Interfaces:**

- Consumes: `resolveTracks()` from `@/lib/dao/tracks` (Task 1).
- Produces: no signature change. `fetchGovernors(api, slug)` still returns `Promise<string[]>`; `DaoDirectoryEntry.governors` keeps its type. Only the contents change — Aave goes from ten entries to three.

- [ ] **Step 1: Swap the import**

In `apps/dashboard/src/lib/daos/directory.ts`, replace line 8:

```ts
import { sourceLabel } from '@/lib/proposals/source';
```

with:

```ts
import { resolveTracks } from '@/lib/dao/tracks';
```

The line keeps its position: the group stays alphabetised as `@/lib/analytics/health`, `@/lib/api/client`, `@/lib/dao/tracks`.

- [ ] **Step 2: Use the classifier**

Replace the body line of `fetchGovernors`:

```ts
return data.data.map((s) => sourceLabel(s.source_type));
```

with:

```ts
return resolveTracks(data.data.map((s) => s.source_type)).map((t) => t.label);
```

- [ ] **Step 3: Update the doc comment on `DaoDirectoryEntry.governors`**

The existing comment at line 22 reads:

```ts
/** Human governor/source labels, e.g. ["Governor Bravo", "Snapshot"]. */
```

Replace it with:

```ts
/** Governance-track labels, e.g. ["Governor Bravo", "Snapshot"] — plumbing excluded. */
```

- [ ] **Step 4: Verify `sourceLabel` is no longer imported here**

```bash
grep -n "sourceLabel" apps/dashboard/src/lib/daos/directory.ts
```

Expected: no output. A leftover unused import fails `pnpm -w lint`.

- [ ] **Step 5: Run the four pre-commit checks**

```bash
pnpm -w format:check && pnpm -w lint && pnpm -w typecheck && pnpm -w test
```

Expected: all four exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/lib/daos/directory.ts
git commit -m "fix(dashboard): list governance tracks, not ingestion sources, in the DAO directory"
```

---

## Manual verification

After Task 4, confirm the change in the running app rather than only in tests.

- [ ] Start the dashboard and open `/daos/aave`. The header reads `Aave` / description / `TRACKS Governance v3 · Governor v2 (legacy) · Snapshot` / `TOKEN 0x7fc6…dae9  Website ↗  Forum ↗`, and no `Governance tracks` section appears anywhere on the page.
- [ ] Hover `Governance v3`; the browser tooltip names AAVE, stkAAVE and aAAVE holders.
- [ ] Open `/daos`. The Aave row lists three tracks, not ten, and no entry contains the word `reconcile`.
- [ ] Open `/daos/compound`. The header shows a tracks row even though Compound is effectively single-track.
- [ ] Narrow the viewport to 375px. The tracks row wraps without overflowing the page horizontally.
