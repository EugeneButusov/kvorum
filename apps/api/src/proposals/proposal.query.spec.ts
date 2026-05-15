import { CROSS_DAO_PROPOSAL_QUERY, PER_DAO_PROPOSAL_QUERY } from './proposal.query';
import { parseQuery } from '../query/query-parser';

describe('proposal.query', () => {
  it('transforms binding true/false to boolean', () => {
    expect(parseQuery({ binding: 'true' }, PER_DAO_PROPOSAL_QUERY).filters['binding']?.value).toBe(
      true,
    );
    expect(parseQuery({ binding: 'false' }, PER_DAO_PROPOSAL_QUERY).filters['binding']?.value).toBe(
      false,
    );
  });

  it('normalizes proposer to lowercase and rejects invalid addresses', () => {
    const parsed = parseQuery(
      { proposer: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      PER_DAO_PROPOSAL_QUERY,
    );
    expect(parsed.filters['proposer']?.value).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(() => parseQuery({ proposer: 'nope' }, PER_DAO_PROPOSAL_QUERY)).toThrow();
  });

  it('rejects invalid voting_starts_at_min format', () => {
    expect(() =>
      parseQuery({ voting_starts_at_min: 'not-a-date' }, PER_DAO_PROPOSAL_QUERY),
    ).toThrow();
  });

  it('rejects unknown filter and unknown sort fields', () => {
    expect(() => parseQuery({ unknown: 'x' }, PER_DAO_PROPOSAL_QUERY)).toThrow();
    expect(() => parseQuery({ sort: 'unknown' }, PER_DAO_PROPOSAL_QUERY)).toThrow();
  });

  it('supports cross-dao multi dao filter', () => {
    const parsed = parseQuery({ dao: 'compound,aave' }, CROSS_DAO_PROPOSAL_QUERY);
    expect(parsed.filters['dao']?.value).toEqual(['compound', 'aave']);
  });
});
