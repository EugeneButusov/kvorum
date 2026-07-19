import { render } from '@testing-library/react';
import { configureAxe } from 'vitest-axe';

import { DataTable, type ChartTableModel } from './charts/data-table';
import { Figure } from './charts/figure';
import { ProposalCard } from './proposal/proposal-card';
import { ErrorContent } from './system/error-content';
import { SystemPage } from './system/system-page';
import { Banner } from './ui/banner';
import { IdentityChip } from './ui/identity-chip';
import { Mismatch } from './ui/mismatch';
import { TooltipProvider } from './ui/tooltip';
import { VoteTag } from './ui/vote-tag';

// Component fragments, not full documents — disable the page-level landmark rule so we assert on
// the markup a11y (roles, names, labels, table structure) rather than page structure. Colour-contrast
// is validated separately (jsdom can't compute layout/colour; it's a Lighthouse/manual concern).
const axe = configureAxe({ rules: { region: { enabled: false } } });

const TABLE: ChartTableModel = {
  columns: [
    { key: 'day', label: 'Day' },
    { key: 'votes', label: 'Votes', numeric: true },
  ],
  rows: [
    { day: '2026-07-01', votes: 12 },
    { day: '2026-07-02', votes: 8 },
  ],
};

async function expectNoViolations(ui: React.ReactNode) {
  const { container } = render(ui);
  expect(await axe(container)).toHaveNoViolations();
}

describe('accessibility (axe) — §6.19', () => {
  it('system page (404) has no violations', async () => {
    await expectNoViolations(
      <SystemPage code="404" title="Page not found" actions={[{ label: '← Home', href: '/' }]}>
        This page could not be found.
      </SystemPage>,
    );
  });

  it('error page (500) content has no violations', async () => {
    await expectNoViolations(
      <ErrorContent error={{ name: 'e', message: 'boom', digest: 'abc123' }} />,
    );
  });

  it('chart figure + its table alternative have no violations', async () => {
    await expectNoViolations(
      <Figure
        title="Turnout"
        table={TABLE}
        legend={[
          { label: 'For', color: '#0a0' },
          { label: 'Against', color: '#a00' },
        ]}
      >
        <svg role="img" aria-label="Turnout over time" viewBox="0 0 10 10" />
      </Figure>,
    );
  });

  it('data table (the accessible alternative) has no violations', async () => {
    await expectNoViolations(<DataTable model={TABLE} />);
  });

  it('banners across severities have no violations', async () => {
    await expectNoViolations(
      <div>
        <Banner severity="warn" glyph="!">
          Ingestion is lagging.
        </Banner>
        <Banner severity="note" glyph="i">
          Heads up.
        </Banner>
        <Banner severity="ok" glyph="✓">
          All good.
        </Banner>
      </div>,
    );
  });

  it('identity chip has no violations', async () => {
    await expectNoViolations(
      <IdentityChip address="0x1234567890abcdef1234567890abcdef12345678" name="alice.eth" />,
    );
  });

  it('mismatch marker (icon + label, not colour alone) has no violations', async () => {
    await expectNoViolations(
      <TooltipProvider>
        <Mismatch
          summary="Calldata transfers to a different address than described."
          href="#detail"
        />
      </TooltipProvider>,
    );
  });

  it('vote tags carry text, not colour alone', async () => {
    await expectNoViolations(
      <div>
        <VoteTag choice="for">For</VoteTag>
        <VoteTag choice="against">Against</VoteTag>
        <VoteTag choice="abstain">Abstain</VoteTag>
      </div>,
    );
  });

  it('the phone proposal card has no violations', async () => {
    // The phone layout swaps the proposals table for cards, so it needs its own check: the tally
    // is a labelled image and the card is a single link wrapping a heading.
    await expectNoViolations(
      <ProposalCard
        showDao
        item={{
          daoSlug: 'compound',
          sourceType: 'compound_governor_oz',
          sourceId: '591',
          title: 'Deprecation of Polygon and Unichain Comets',
          state: 'queued',
          binding: true,
          votingStartsAt: null,
          votingEndsAt: '2026-07-18T07:47:00.000Z',
          proposer: { address: '0x7b3cabcdefabcdefabcdefabcdefabcdefabcc33', displayName: null },
          tally: [
            { kind: 'for', pct: 75 },
            { kind: 'against', pct: 25 },
          ],
          href: '/daos/compound/proposals/compound_governor_oz/591',
        }}
      />,
    );
  });
});
