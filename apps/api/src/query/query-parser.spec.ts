import { z } from 'zod';
import type { EndpointQuery } from './query-descriptor';
import { parseQuery } from './query-parser';
import { ProblemException } from '../http/problem-exception';

const descriptor: EndpointQuery = {
  filters: {
    state: { zod: z.string(), column: 'proposal.state', op: 'in', multi: true },
    author: { zod: z.coerce.number().int(), column: 'proposal.author_id', op: 'eq' },
    from: { zod: z.coerce.number().int(), column: 'proposal.block_num', op: 'gte' },
    to: { zod: z.coerce.number().int(), column: 'proposal.block_num', op: 'lte' },
    name: { zod: z.string(), column: 'proposal.name', op: 'eq' },
  },
  sortable: {
    created_at: { column: 'proposal.created_at' },
    voting_starts_at: { column: 'proposal.voting_starts_at', nullable: true },
  },
  defaultSort: [{ field: 'created_at', dir: 'desc' }],
};

describe('parseQuery', () => {
  it('throws unknown-filter for undeclared params', () => {
    try {
      parseQuery({ bogus: '1' }, descriptor);
      throw new Error('expected parseQuery to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemException);
      const problem = error as ProblemException;
      expect(problem.slug).toBe('unknown-filter');
      expect(problem.violations?.[0]?.message).toContain("unknown filter parameter 'bogus'");
    }
  });

  it('throws unknown-sort-field for unsupported sort fields', () => {
    try {
      parseQuery({ sort: 'nope' }, descriptor);
      throw new Error('expected parseQuery to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemException);
      const problem = error as ProblemException;
      expect(problem.slug).toBe('unknown-sort-field');
      expect(problem.violations?.[0]?.message).toContain("unknown sort field 'nope'");
    }
  });

  it('parses multi-value filter and typed scalar filters', () => {
    const parsed = parseQuery(
      {
        state: 'queued,active',
        author: '42',
        from: '100',
        to: '200',
      },
      descriptor,
    );

    expect(parsed.filters['state']?.value).toEqual(['queued', 'active']);
    expect(parsed.filters['author']?.value).toBe(42);
    expect(parsed.filters['from']?.value).toBe(100);
    expect(parsed.filters['to']?.value).toBe(200);
  });

  it('uses descriptor default sort when sort is absent', () => {
    const parsed = parseQuery({}, descriptor);
    expect(parsed.sort).toEqual([
      {
        field: 'created_at',
        column: 'proposal.created_at',
        dir: 'desc',
        nullable: false,
        kind: undefined,
      },
    ]);
  });

  it('propagates zod validation failures', () => {
    expect(() => parseQuery({ author: 'abc' }, descriptor)).toThrow();
  });

  it('normalizes string filter values to NFC', () => {
    const nfd = 'Cafe\u0301';
    const nfc = 'Café';

    const fromNfd = parseQuery({ name: nfd }, descriptor);
    const fromNfc = parseQuery({ name: nfc }, descriptor);

    expect(fromNfd.filters['name']?.value).toBe(fromNfc.filters['name']?.value);
    expect(fromNfd.filters['name']?.value).toBe(nfc);
  });
});
