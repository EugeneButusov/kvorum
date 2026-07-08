import { createHmac } from 'node:crypto';
import {
  assertCursorMatchesQuery,
  buildPagination,
  canonicalQuery,
  compareSortKeys,
  decodeCursor,
  encodeCursor,
  parseLimit,
  sortAndSeek,
} from './cursor';
import { resetCursorConfigForTests } from './cursor.config';
import { ProblemException } from '../http/problem-exception';
import type { ParsedQuery } from '../query/query-descriptor';

const parsedQuery: ParsedQuery = {
  filters: {
    state: {
      field: 'state',
      column: 'proposal.state',
      op: 'in',
      multi: true,
      value: ['queued', 'active'],
    },
    author: {
      field: 'author',
      column: 'proposal.author_id',
      op: 'eq',
      multi: false,
      value: 42,
    },
  },
  sort: [
    {
      field: 'created_at',
      column: 'proposal.created_at',
      dir: 'desc',
      nullable: false,
      kind: undefined,
    },
  ],
};

describe('cursor', () => {
  beforeEach(() => {
    process.env['CURSOR_SECRET'] = 'test-secret';
    resetCursorConfigForTests();
  });

  it('round-trips encode/decode', () => {
    const payload = {
      type: 'time' as const,
      value: '2026-05-15T00:00:00.000Z',
      tiebreak: 'p-1',
      dir: 'desc' as const,
      q: canonicalQuery(parsedQuery),
    };

    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('rejects malformed payloads as invalid-cursor', () => {
    expect(() => decodeCursor('bad')).toThrow(ProblemException);
    expect(() => decodeCursor('bad')).toThrow(/cursor is invalid/i);

    const badJson = Buffer.from('{"foo":1}', 'utf8').toString('base64url');
    const bad = `${badJson}.AAAA`;
    expect(() => decodeCursor(bad)).toThrow(ProblemException);
  });

  it('rejects tampered payload with stale tag', () => {
    const payload = {
      type: 'time' as const,
      value: '2026-05-15T00:00:00.000Z',
      tiebreak: 'p-1',
      dir: 'desc' as const,
      q: canonicalQuery(parsedQuery),
    };

    const encoded = encodeCursor(payload);
    const [p, tag] = encoded.split('.');
    const parsed = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    parsed['tiebreak'] = 'p-2';
    const tamperedPayload = Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url');
    expect(() => decodeCursor(`${tamperedPayload}.${tag}`)).toThrow(/cursor is invalid/i);
  });

  it('rejects recomputed tag under wrong secret', () => {
    const payload = {
      type: 'time' as const,
      value: '2026-05-15T00:00:00.000Z',
      tiebreak: 'p-1',
      dir: 'desc' as const,
      q: canonicalQuery(parsedQuery),
    };

    const encoded = encodeCursor(payload);
    process.env['CURSOR_SECRET'] = 'wrong-secret';
    resetCursorConfigForTests();
    const wrongSigned = encodeCursor(payload);
    process.env['CURSOR_SECRET'] = 'test-secret';
    resetCursorConfigForTests();

    expect(() => decodeCursor(wrongSigned)).toThrow(/cursor is invalid/i);
    expect(decodeCursor(encoded)).toEqual(payload);
  });

  it('canonicalQuery is stable for normalized equivalents and differs for changed sort/filter', () => {
    const q1: ParsedQuery = {
      filters: {
        state: {
          field: 'state',
          column: 'proposal.state',
          op: 'in',
          multi: true,
          value: ['b', 'a'],
        },
        name: {
          field: 'name',
          column: 'proposal.name',
          op: 'eq',
          multi: false,
          value: 'Cafe\u0301',
        },
      },
      sort: [
        {
          field: 'created_at',
          column: 'proposal.created_at',
          dir: 'asc',
          nullable: false,
          kind: undefined,
        },
      ],
    };

    const q2: ParsedQuery = {
      filters: {
        name: {
          field: 'name',
          column: 'proposal.name',
          op: 'eq',
          multi: false,
          value: 'Café',
        },
        state: {
          field: 'state',
          column: 'proposal.state',
          op: 'in',
          multi: true,
          value: ['a', 'b'],
        },
      },
      sort: [
        {
          field: 'created_at',
          column: 'proposal.created_at',
          dir: 'asc',
          nullable: false,
          kind: undefined,
        },
      ],
    };

    const q3: ParsedQuery = {
      ...q2,
      sort: [
        {
          field: 'created_at',
          column: 'proposal.created_at',
          dir: 'desc',
          nullable: false,
          kind: undefined,
        },
      ],
    };

    expect(canonicalQuery(q1)).toBe(canonicalQuery(q2));
    expect(canonicalQuery(q1)).not.toBe(canonicalQuery(q3));
  });

  it('assertCursorMatchesQuery throws mismatch and accepts exact match', () => {
    const q = canonicalQuery(parsedQuery);
    const cursor = {
      type: 'time' as const,
      value: '2026-05-15T00:00:00.000Z',
      tiebreak: 'p-1',
      dir: 'desc' as const,
      q,
    };

    expect(() => assertCursorMatchesQuery(cursor, parsedQuery)).not.toThrow();

    const changed: ParsedQuery = {
      ...parsedQuery,
      filters: {
        ...parsedQuery.filters,
        author: {
          ...parsedQuery.filters['author']!,
          value: 99,
        },
      },
    };

    expect(() => assertCursorMatchesQuery(cursor, changed)).toThrow(/cursor does not match/i);
  });

  it('parseLimit applies defaults/clamp and rejects invalid inputs', () => {
    expect(parseLimit(undefined)).toBe(50);
    expect(parseLimit('')).toBe(50);
    expect(parseLimit('300')).toBe(200);
    expect(parseLimit('1')).toBe(1);

    for (const bad of ['0', '-5', '50.5', 'abc', '0x10']) {
      try {
        parseLimit(bad);
        throw new Error('expected parseLimit to throw');
      } catch (error) {
        const problem = error as ProblemException;
        expect(problem.slug).toBe('validation');
        expect(problem.violations?.[0]?.message).toBe('must be an integer between 1 and 200');
      }
    }
  });

  it('buildPagination emits has_more and signed next_cursor from last row', () => {
    const rows = [
      { id: 'a', ts: '2026-05-15T10:00:00.000Z' },
      { id: 'b', ts: '2026-05-15T09:00:00.000Z' },
      { id: 'c', ts: '2026-05-15T08:00:00.000Z' },
    ];

    const out = buildPagination(rows, 2, (row) => ({
      type: 'time',
      value: row.ts,
      tiebreak: row.id,
      dir: 'desc',
      q: canonicalQuery(parsedQuery),
    }));

    expect(out.data).toHaveLength(2);
    expect(out.pagination.has_more).toBe(true);
    expect(out.pagination.next_cursor).toBeTruthy();

    const decoded = decodeCursor(out.pagination.next_cursor!);
    expect(decoded.value).toBe('2026-05-15T09:00:00.000Z');
    expect(decoded.tiebreak).toBe('b');
  });

  it('round-trips numeric and bigint cursor payload types', () => {
    const q = canonicalQuery(parsedQuery);
    const numeric = {
      type: 'numeric' as const,
      value: '12345678901234567890.42',
      tiebreak: 'p-1',
      dir: 'asc' as const,
      q,
    };
    const bigint = {
      type: 'bigint' as const,
      value: '9223372036854775807',
      tiebreak: 99,
      dir: 'desc' as const,
      q,
    };

    expect(decodeCursor(encodeCursor(numeric))).toEqual(numeric);
    expect(decodeCursor(encodeCursor(bigint))).toEqual(bigint);
  });
});

describe('sortAndSeek (in-memory keyset)', () => {
  beforeEach(() => {
    process.env['CURSOR_SECRET'] = 'test-secret';
    resetCursorConfigForTests();
  });

  // A validly-signed cursor whose payload is `raw` bytes — exercises decode paths past the tag check.
  const signedCursor = (raw: string) => {
    const enc = Buffer.from(raw, 'utf8').toString('base64url');
    const tag = createHmac('sha256', 'test-secret')
      .update(enc, 'utf8')
      .digest()
      .toString('base64url');
    return `${enc}.${tag}`;
  };

  it('decodeCursor rejects a validly-signed but non-JSON payload', () => {
    expect(() => decodeCursor(signedCursor('not json'))).toThrow(/cursor is invalid/i);
  });

  it('decodeCursor rejects a validly-signed payload that fails the schema', () => {
    expect(() => decodeCursor(signedCursor(JSON.stringify({ foo: 1 })))).toThrow(
      /cursor is invalid/i,
    );
  });

  type Row = { id: string; cast_at: string; vp: string };
  const Q = '{}'; // canonical-query string; schema requires length >= 2
  const timeKey = (r: Row) => ({
    type: 'time' as const,
    value: r.cast_at,
    tiebreak: r.id,
    dir: 'desc' as const,
    q: Q,
  });

  // Two votes share the same second (common for Snapshot) so the tiebreak actually matters.
  const rows: Row[] = [
    { id: 'a', cast_at: '2024-01-03T00:00:00.000Z', vp: '30' },
    { id: 'c', cast_at: '2024-01-01T00:00:00.000Z', vp: '10' },
    { id: 'b', cast_at: '2024-01-01T00:00:00.000Z', vp: '20' }, // same second as c
  ];

  it('sorts desc by value then tiebreak when there is no cursor', () => {
    expect(sortAndSeek(rows, undefined, timeKey).map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('seeks strictly past the cursor position, breaking same-value ties by tiebreak', () => {
    // cursor at {value: 2024-01-01, tiebreak: 'c'} → only 'b' (same second, id 'b' < 'c') remains.
    const cursor = {
      type: 'time' as const,
      value: '2024-01-01T00:00:00.000Z',
      tiebreak: 'c',
      dir: 'desc' as const,
      q: Q,
    };
    expect(sortAndSeek(rows, cursor, timeKey).map((r) => r.id)).toEqual(['b']);
  });

  it('never loops: paging with limit 1 visits every row exactly once', () => {
    const seen: string[] = [];
    let cursor: ReturnType<typeof decodeCursor> | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = buildPagination(sortAndSeek(rows, cursor, timeKey), 1, timeKey);
      seen.push(...page.data.map((r) => r.id));
      if (!page.pagination.next_cursor) break;
      cursor = decodeCursor(page.pagination.next_cursor);
    }
    expect(seen).toEqual(['a', 'c', 'b']); // full, ordered, no repeats — the infinite loop is gone
  });

  it('compareSortKeys orders numeric values by magnitude, not lexically', () => {
    const k = (v: string, tb = '') => ({
      type: 'numeric' as const,
      value: v,
      tiebreak: tb,
      dir: 'asc' as const,
    });
    expect(compareSortKeys(k('9'), k('100'))).toBeLessThan(0); // 9 < 100 (would be > 0 lexically)
    expect(compareSortKeys(k('100'), k('9'))).toBeGreaterThan(0); // 100 > 9
    expect(compareSortKeys(k('5', 'a'), k('5', 'b'))).toBeLessThan(0); // equal value → tiebreak decides
  });

  it('parseLimit accepts an array-valued query param (first element)', () => {
    expect(parseLimit(['5'])).toBe(5);
    expect(parseLimit([])).toBe(50); // empty array → default
  });
});
