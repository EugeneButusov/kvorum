import { notFoundGuidance } from './not-found-guidance';

describe('notFoundGuidance', () => {
  it('names the untracked DAO slug and lists coverage', () => {
    const g = notFoundGuidance('dao', '/daos/sushi');
    expect(g.title).toBe('DAO not tracked');
    expect(g.message).toContain('sushi');
    expect(g.message).toMatch(/Compound.*Aave.*Lido/);
    expect(g.actions.map((a) => a.href)).toContain('/daos');
  });

  it('uses the DAO display name and links its proposal list for an unknown proposal', () => {
    const g = notFoundGuidance('proposal', '/daos/lido/proposals/aragon_voting/999');
    expect(g.title).toBe('Proposal not found');
    expect(g.message).toContain('Lido');
    expect(g.actions.map((a) => a.href)).toContain('/daos/lido/proposals');
  });

  it('reports no recorded activity for an actor, truncating the address', () => {
    const g = notFoundGuidance('actor', '/actors/0x1234567890abcdef1234567890abcdef12345678');
    expect(g.title).toBe('No activity recorded');
    expect(g.message).toMatch(/0x1234.*5678/);
  });

  it('falls back to a generic message', () => {
    const g = notFoundGuidance('generic', '/whatever');
    expect(g.title).toBe('Page not found');
    expect(g.actions).toEqual([{ label: '← Home', href: '/' }]);
  });
});
