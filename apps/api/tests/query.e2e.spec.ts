import { Controller, Get, Module, Query } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { HttpModule } from '../src/http/http.module';
import {
  assertCursorMatchesQuery,
  buildPagination,
  canonicalQuery,
  decodeCursor,
  parseLimit,
} from '../src/pagination/cursor';
import type { EndpointQuery } from '../src/query/query-descriptor';
import { parseQuery } from '../src/query/query-parser';

type Proposal = {
  id: string;
  state: string;
  voting_starts_at: string | null;
};

const DATA: Proposal[] = [
  { id: 'p4', state: 'active', voting_starts_at: null },
  { id: 'p3', state: 'queued', voting_starts_at: '2026-05-15T12:00:00.000Z' },
  { id: 'p2', state: 'active', voting_starts_at: '2026-05-15T12:00:00.000Z' },
  { id: 'p1', state: 'active', voting_starts_at: '2026-05-15T11:00:00.000Z' },
];

const descriptor: EndpointQuery = {
  filters: {
    state: { zod: z.string(), column: 'proposal.state', op: 'in', multi: true },
  },
  sortable: {
    voting_starts_at: { column: 'proposal.voting_starts_at', nullable: true },
  },
  defaultSort: [{ field: 'voting_starts_at', dir: 'desc' }],
  tiebreakColumn: 'proposal.id',
};

const describeHttpIf = process.env.NEST_HTTP_TESTS === '1' ? describe : describe.skip;

@Controller()
class QueryController {
  @Get('proposals')
  list(@Query() rawQuery: Record<string, unknown>) {
    const parsed = parseQuery(rawQuery, descriptor);
    const limit = parseLimit(rawQuery['limit']);

    const cursorRaw = typeof rawQuery['cursor'] === 'string' ? rawQuery['cursor'] : undefined;
    const cursor = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw);
    if (cursor !== undefined) {
      assertCursorMatchesQuery(cursor, parsed);
    }

    const canonical = canonicalQuery(parsed);
    const filtered = DATA.filter((row) => {
      const filter = parsed.filters['state'];
      if (filter === undefined) {
        return true;
      }

      const wanted = filter.value as string[];
      return wanted.includes(row.state);
    });

    const sorted = [...filtered].sort((a, b) => compareRows(a, b, parsed.sort[0]?.dir ?? 'desc'));

    const paged = cursor === undefined ? sorted : sorted.filter((row) => isAfter(row, cursor));
    const rows = paged.slice(0, limit + 1);

    return buildPagination(rows, limit, (row) => ({
      value: coalescedValue(row, parsed.sort[0]?.dir ?? 'desc'),
      tiebreak: row.id,
      dir: parsed.sort[0]?.dir ?? 'desc',
      q: canonical,
    }));
  }
}

@Module({
  imports: [HttpModule],
  controllers: [QueryController],
})
class QueryTestModule {}

function coalescedValue(row: Proposal, dir: 'asc' | 'desc'): string {
  if (row.voting_starts_at !== null) {
    return row.voting_starts_at;
  }

  return dir === 'asc' ? '9999-12-31T23:59:59.999Z' : '0000-01-01T00:00:00.000Z';
}

function compareRows(a: Proposal, b: Proposal, dir: 'asc' | 'desc'): number {
  const av = coalescedValue(a, dir);
  const bv = coalescedValue(b, dir);

  if (av === bv) {
    return dir === 'asc' ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
  }

  return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
}

function isAfter(
  row: Proposal,
  cursor: { value: string; tiebreak: string | number; dir: 'asc' | 'desc' },
): boolean {
  const value = coalescedValue(row, cursor.dir);
  const tiebreak = String(cursor.tiebreak);

  if (cursor.dir === 'asc') {
    return value > cursor.value || (value === cursor.value && row.id > tiebreak);
  }

  return value < cursor.value || (value === cursor.value && row.id < tiebreak);
}

describeHttpIf('query e2e', () => {
  async function createApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [QueryTestModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
  }

  beforeEach(() => {
    process.env['CURSOR_SECRET'] = 'test-secret';
  });

  it('paginates with next_cursor and no overlap including null sort row', async () => {
    const app = await createApp();

    try {
      const page1 = await request(app.getHttpServer()).get(
        '/proposals?sort=-voting_starts_at&limit=2',
      );
      expect(page1.status).toBe(200);
      expect(page1.body.pagination.next_cursor).toBeTruthy();

      const cursor = encodeURIComponent(String(page1.body.pagination.next_cursor));
      const page2 = await request(app.getHttpServer()).get(
        `/proposals?sort=-voting_starts_at&limit=2&cursor=${cursor}`,
      );
      expect(page2.status).toBe(200);

      const ids1 = new Set((page1.body.data as Proposal[]).map((x) => x.id));
      const ids2 = new Set((page2.body.data as Proposal[]).map((x) => x.id));
      for (const id of ids1) {
        expect(ids2.has(id)).toBe(false);
      }

      const combined = [...ids1, ...ids2];
      expect(combined.includes('p4')).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('returns 400 cursor-parameter-mismatch for conflicting filters', async () => {
    const app = await createApp();

    try {
      const page1 = await request(app.getHttpServer()).get('/proposals?state=active&limit=2');
      const cursor = encodeURIComponent(String(page1.body.pagination.next_cursor));
      const response = await request(app.getHttpServer()).get(
        `/proposals?state=queued&limit=2&cursor=${cursor}`,
      );

      expect(response.status).toBe(400);
      expect(response.body.type).toBe('urn:error:cursor-parameter-mismatch');
      expect(Array.isArray(response.body.violations)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('returns 400 invalid-cursor for forged cursor', async () => {
    const app = await createApp();

    try {
      const page1 = await request(app.getHttpServer()).get('/proposals?limit=2');
      const goodCursor = String(page1.body.pagination.next_cursor);
      const forged = `${goodCursor.slice(0, -1)}${goodCursor.slice(-1) === 'A' ? 'B' : 'A'}`;
      const response = await request(app.getHttpServer()).get(
        `/proposals?limit=2&cursor=${encodeURIComponent(forged)}`,
      );

      expect(response.status).toBe(400);
      expect(response.body.type).toBe('urn:error:invalid-cursor');
    } finally {
      await app.close();
    }
  });

  it('clamps limit and validates unknown query params', async () => {
    const app = await createApp();

    try {
      const clamped = await request(app.getHttpServer()).get('/proposals?limit=300');
      expect(clamped.status).toBe(200);
      expect(clamped.body.pagination.limit).toBe(200);

      const unknownFilter = await request(app.getHttpServer()).get('/proposals?bogus=1');
      expect(unknownFilter.status).toBe(400);
      expect(unknownFilter.body.type).toBe('urn:error:unknown-filter');

      const unknownSort = await request(app.getHttpServer()).get('/proposals?sort=nope');
      expect(unknownSort.status).toBe(400);
      expect(unknownSort.body.type).toBe('urn:error:unknown-sort-field');
    } finally {
      await app.close();
    }
  });
});
