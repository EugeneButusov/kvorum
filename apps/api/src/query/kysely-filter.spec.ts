import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { z } from 'zod';
import { applyQuery } from './kysely-filter';
import type { EndpointQuery } from './query-descriptor';
import { parseQuery } from './query-parser';

type ProposalTable = {
  id: string;
  state: string;
  created_at: string;
  voting_starts_at: string | null;
  score: number;
};

type TestDb = {
  proposal: ProposalTable;
};

const descriptor: EndpointQuery = {
  filters: {
    state: { zod: z.string(), column: 'proposal.state', op: 'eq' },
    score_min: {
      zod: z.coerce.number(),
      column: 'proposal.score',
      op: 'gte',
    },
    score_max: {
      zod: z.coerce.number(),
      column: 'proposal.score',
      op: 'lte',
    },
    states: {
      zod: z.string(),
      column: 'proposal.state',
      op: 'in',
      multi: true,
    },
  },
  sortable: {
    created_at: { column: 'proposal.created_at' },
    voting_starts_at: { column: 'proposal.voting_starts_at', nullable: true },
  },
  defaultSort: [{ field: 'created_at', dir: 'asc' }],
  tiebreakColumn: 'proposal.id',
};

describe('applyQuery', () => {
  const pool = new Pool({ connectionString: 'postgres://unused:unused@localhost:5432/unused' });
  const db = new Kysely<TestDb>({ dialect: new PostgresDialect({ pool }) });

  afterAll(async () => {
    await db.destroy();
  });

  it('applies simple eq filters and limit+1', () => {
    const parsed = parseQuery({ state: 'active', sort: 'created_at' }, descriptor);
    const compiled = applyQuery(
      db.selectFrom('proposal').selectAll(),
      parsed,
      descriptor,
      50,
    ).compile();

    expect(compiled.sql).toContain('where "proposal"."state" = $1');
    expect(compiled.sql).toContain('order by proposal.created_at asc, "proposal"."id" asc');
    expect(compiled.sql).toContain('limit $2');
    expect(compiled.parameters).toEqual(['active', 51]);
  });

  it('applies multi-value in filter and range filters', () => {
    const parsed = parseQuery(
      { states: 'queued,active', score_min: '10', score_max: '99', sort: '-created_at' },
      descriptor,
    );
    const compiled = applyQuery(
      db.selectFrom('proposal').selectAll(),
      parsed,
      descriptor,
      20,
    ).compile();

    expect(compiled.sql).toContain('"proposal"."state" in ($3, $4)');
    expect(compiled.sql).toContain('"proposal"."score" >= $1');
    expect(compiled.sql).toContain('"proposal"."score" <= $2');
    expect(compiled.sql).toContain('order by proposal.created_at desc, "proposal"."id" desc');
  });

  it('emits expanded asc keyset predicate', () => {
    const parsed = parseQuery({ sort: 'created_at' }, descriptor);
    const compiled = applyQuery(db.selectFrom('proposal').selectAll(), parsed, descriptor, 10, {
      value: '2026-05-15T10:00:00.000Z',
      tiebreak: 'p2',
      dir: 'asc',
    }).compile();

    expect(compiled.sql).toContain(
      '(proposal.created_at > $1 or (proposal.created_at = $2 and "proposal"."id" > $3))',
    );
  });

  it('emits expanded desc keyset predicate', () => {
    const parsed = parseQuery({ sort: '-created_at' }, descriptor);
    const compiled = applyQuery(db.selectFrom('proposal').selectAll(), parsed, descriptor, 10, {
      value: '2026-05-15T10:00:00.000Z',
      tiebreak: 'p2',
      dir: 'desc',
    }).compile();

    expect(compiled.sql).toContain(
      '(proposal.created_at < $1 or (proposal.created_at = $2 and "proposal"."id" < $3))',
    );
  });

  it('uses COALESCE sentinel ordering for nullable columns in both directions', () => {
    const asc = parseQuery({ sort: 'voting_starts_at' }, descriptor);
    const ascSql = applyQuery(db.selectFrom('proposal').selectAll(), asc, descriptor, 5).compile()
      .sql;
    expect(ascSql).toContain(
      "order by coalesce(proposal.voting_starts_at, 'infinity'::timestamptz) asc",
    );

    const desc = parseQuery({ sort: '-voting_starts_at' }, descriptor);
    const descSql = applyQuery(db.selectFrom('proposal').selectAll(), desc, descriptor, 5).compile()
      .sql;
    expect(descSql).toContain(
      "order by coalesce(proposal.voting_starts_at, '-infinity'::timestamptz) desc",
    );
  });

  it('rejects injection-shaped sort/filter names during parsing', () => {
    expect(() => parseQuery({ sort: 'created_at;drop table proposal' }, descriptor)).toThrow();
    expect(() => parseQuery({ 'state;drop table proposal': 'x' }, descriptor)).toThrow();
  });
});
