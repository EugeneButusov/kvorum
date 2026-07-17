import { fireEvent, render, screen } from '@testing-library/react';

import { ProposalFilters } from './proposal-filters';
import { EMPTY_FILTERS, type ProposalFilters as Filters } from '../../lib/proposals/list';

function setup(filters: Partial<Filters> = {}, sourceOptions: string[] = []) {
  const onChange = vi.fn();
  render(
    <ProposalFilters
      scope="dao"
      filters={{ ...EMPTY_FILTERS, ...filters }}
      onChange={onChange}
      daoOptions={[]}
      sourceOptions={sourceOptions}
    />,
  );
  return onChange;
}

const stateButton = (name: string) =>
  screen.getByRole('toolbar', { name: 'Filter by state' }).querySelector<HTMLButtonElement>(
    // Radix items expose their pressed state via data-state.
    `button[data-state]`,
  ) && screen.getByRole('button', { name });

describe('ProposalFilters state facet', () => {
  it('selects a state when the facet is showing "All"', () => {
    // Regression: the "All" segment is rendered for an empty facet, so diffing the incoming value
    // against the raw (empty) filter made every item look newly added — the first one being "All",
    // which cleared the facet. Picking a state did nothing at all.
    const onChange = setup({ state: [] });

    fireEvent.click(stateButton('pending')!);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: ['pending'] }));
  });

  it('adds to an existing selection rather than replacing it', () => {
    const onChange = setup({ state: ['pending'] });

    fireEvent.click(stateButton('queued')!);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ state: expect.arrayContaining(['pending', 'queued']) }),
    );
  });

  it('clears the facet when "All" is picked', () => {
    const onChange = setup({ state: ['pending', 'queued'] });

    fireEvent.click(
      screen.getByRole('toolbar', { name: 'Filter by state' }).querySelector('button')!,
    );

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: [] }));
  });

  it('falls back to "All" when the last selected state is unpicked', () => {
    const onChange = setup({ state: ['pending'] });

    fireEvent.click(stateButton('pending')!);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: [] }));
  });

  it('never leaks the "All" sentinel into the filter value', () => {
    const onChange = setup({ state: [] });

    fireEvent.click(stateButton('active')!);

    const next = onChange.mock.calls[0]?.[0] as Filters;
    expect(next.state).not.toContain('__all__');
  });
});

describe('ProposalFilters source facet', () => {
  it('is offered once a DAO has more than one source', () => {
    setup({}, ['aave_governance_v3', 'aave_payloads_controller']);

    const group = screen.getByRole('radiogroup', { name: 'Filter by source' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Aave governance v3' })).toBeInTheDocument();
  });

  it('is hidden for a single-source DAO, where it could only ever be a no-op', () => {
    setup({}, ['aave_governance_v3']);

    expect(screen.queryByRole('radiogroup', { name: 'Filter by source' })).not.toBeInTheDocument();
  });

  it('selects a source', () => {
    const onChange = setup({}, ['aave_governance_v3', 'aave_payloads_controller']);

    fireEvent.click(screen.getByRole('radio', { name: 'Aave payloads controller' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'aave_payloads_controller' }),
    );
  });

  it('returns to all sources when "All" is picked', () => {
    const onChange = setup({ sourceType: 'aave_governance_v3' }, [
      'aave_governance_v3',
      'aave_payloads_controller',
    ]);

    fireEvent.click(
      screen.getByRole('radiogroup', { name: 'Filter by source' }).querySelector('button')!,
    );

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sourceType: null }));
  });
});
