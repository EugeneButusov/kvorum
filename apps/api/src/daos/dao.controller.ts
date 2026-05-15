import { Controller, Get, Param, Query } from '@nestjs/common';
import { DaoReadRepository } from '@libs/db';
import { toDaoDetailDto, toDaoListItemDto, toDaoSourceDto } from './dao.mappers';
import { DAO_LIST_QUERY } from './dao.query';
import { CacheControl } from '../cache/cache-control.decorator';
import { problemException } from '../http/problem-exception';
import {
  assertCursorMatchesQuery,
  buildPagination,
  canonicalQuery,
  decodeCursor,
  parseLimit,
} from '../pagination/cursor';
import { applyQuery } from '../query/kysely-filter';
import { parseQuery } from '../query/query-parser';

@Controller('v1/daos')
export class DaoController {
  constructor(private readonly repo: DaoReadRepository) {}

  @Get()
  @CacheControl({ visibility: 'public', maxAgeSecs: 60 })
  async list(@Query() rawQuery: Record<string, unknown>) {
    const parsed = parseQuery(rawQuery, DAO_LIST_QUERY);
    const limit = parseLimit(rawQuery['limit']);

    const cursorRaw = typeof rawQuery['cursor'] === 'string' ? rawQuery['cursor'] : undefined;
    const cursor = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw);
    if (cursor !== undefined) {
      // ADR-044: conflicting cursor/query params are a 400 cursor-parameter-mismatch.
      assertCursorMatchesQuery(cursor, parsed);
    }

    const canonical = canonicalQuery(parsed);
    const rows = await applyQuery(
      this.repo.listBaseQuery(),
      parsed,
      DAO_LIST_QUERY,
      limit,
      cursor,
    ).execute();
    const page = buildPagination(rows, limit, (row) => {
      const primarySort = parsed.sort[0] ?? DAO_LIST_QUERY.defaultSort[0];
      const dir = primarySort?.dir ?? 'asc';
      const value =
        primarySort?.field === 'created_at' ? new Date(row.created_at).toISOString() : row.slug;

      return {
        value,
        tiebreak: row.id,
        dir,
        q: canonical,
      };
    });

    return {
      data: page.data.map(toDaoListItemDto),
      pagination: page.pagination,
    };
  }

  @Get(':slug')
  @CacheControl({ visibility: 'public', maxAgeSecs: 60 })
  async detail(@Param('slug') slug: string) {
    const dao = await this.repo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const sources = await this.repo.listSourcesForDao(dao.id);

    return { data: toDaoDetailDto(dao, sources) };
  }

  @Get(':slug/sources')
  @CacheControl({ visibility: 'public', maxAgeSecs: 60 })
  async sources(@Param('slug') slug: string) {
    const dao = await this.repo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const sources = await this.repo.listSourcesForDao(dao.id);
    return { data: sources.map(toDaoSourceDto) };
  }
}
