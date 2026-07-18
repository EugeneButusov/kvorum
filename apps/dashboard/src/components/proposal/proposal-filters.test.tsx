import { fireEvent, render, screen } from '@testing-library/react';

import { ProposalFilters } from './proposal-filters';
import { EMPTY_FILTERS, type ProposalFilters as Filters } from '../../lib/proposals/list';

function setup(filters: Partial<Filters> = {}, scope: 'cross' | 'dao' = 'dao') {
  const onChange = vi.fn();
  render(
    <ProposalFilters
      scope={scope}
      filters={{ ...EMPTY_FILTERS, ...filters }}
      onChange={onChange}
      daoOptions={[
        { slug: 'lido', name: 'Lido' },
        { slug: 'aave', name: 'Aave' },
      ]}
    />,
  );
  return onChange;
}

const stateFacet = () => screen.getByRole('toolbar', { name: 'Filter by state' });
const stateButton = (name: string) => screen.getByRole('button', { name });
/** The leading segment of a facet is always "All". */
const allButton = (facet: HTMLElement) => facet.querySelector('button')!;

describe('ProposalFilters state facet', () => {
  it('selects a state when the facet is showing "All"', () => {
    // Regression: the "All" segment is rendered for an empty facet, so diffing the incoming value
    // against the raw (empty) filter made every item look newly added — the first one being "All",
    // which cleared the facet. Picking a state did nothing at all.
    const onChange = setup({ state: [] });

    fireEvent.click(stateButton('pending'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: ['pending'] }));
  });

  it('adds to an existing selection rather than replacing it', () => {
    const onChange = setup({ state: ['pending'] });

    fireEvent.click(stateButton('queued'));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ state: expect.arrayContaining(['pending', 'queued']) }),
    );
  });

  it('clears the facet when "All" is picked', () => {
    const onChange = setup({ state: ['pending', 'queued'] });

    fireEvent.click(allButton(stateFacet()));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: [] }));
  });

  it('falls back to "All" when the last selected state is unpicked', () => {
    const onChange = setup({ state: ['pending'] });

    fireEvent.click(stateButton('pending'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: [] }));
  });

  it('never leaks the "All" sentinel into the filter value', () => {
    const onChange = setup({ state: [] });

    fireEvent.click(stateButton('active'));

    const next = onChange.mock.calls[0]?.[0] as Filters;
    expect(next.state).not.toContain('__all__');
  });
});

describe('ProposalFilters facets', () => {
  it('offers only DAO and State — no source, type, or date facet', () => {
    setup({}, 'cross');

    expect(screen.getByRole('toolbar', { name: 'Filter by DAO' })).toBeInTheDocument();
    expect(stateFacet()).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Filter by source' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Filter by type' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Voting start from')).not.toBeInTheDocument();
  });

  it('hides the DAO facet on a DAO-scoped list, where it would be redundant', () => {
    setup({}, 'dao');

    expect(screen.queryByRole('toolbar', { name: 'Filter by DAO' })).not.toBeInTheDocument();
    expect(stateFacet()).toBeInTheDocument();
  });

  it('selects a DAO', () => {
    const onChange = setup({}, 'cross');

    fireEvent.click(screen.getByRole('button', { name: 'Aave' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ dao: ['aave'] }));
  });
});
