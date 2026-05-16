import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DaoReadRepository } from '@libs/db';
import { DaoDetailResponseDto, DaoListResponseDto, DaoSourceListResponseDto } from './dao.dto';
import { toDaoDetailDto, toDaoListItemDto, toDaoSourceDto } from './dao.mappers';
import { DAO_LIST_QUERY } from './dao.query';
import { CacheControl } from '../cache/cache-control.decorator';
import { problemException } from '../http/problem-exception';
import { ProblemDto } from '../openapi/openapi.dto';
import {
  assertCursorMatchesQuery,
  buildPagination,
  canonicalQuery,
  decodeCursor,
  parseLimit,
} from '../pagination/cursor';
import { applyQuery } from '../query/kysely-filter';
import { parseQuery } from '../query/query-parser';

@ApiTags('daos')
@ApiBearerAuth()
@Controller('v1/daos')
export class DaoController {
  constructor(private readonly repo: DaoReadRepository) {}

  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'sort', required: false, type: String, example: 'slug,-created_at' })
  @ApiOkResponse({ type: DaoListResponseDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @Get()
  @CacheControl({ visibility: 'public', maxAgeSecs: 60 })
  async list(@Query() rawQuery: Record<string, unknown>) {
    const parsed = parseQuery(rawQuery, DAO_LIST_QUERY);
    const limit = parseLimit(rawQuery['limit']);

    const cursorRaw = typeof rawQuery['cursor'] === 'string' ? rawQuery['cursor'] : undefined;
    const cursor = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw);
    if (cursor !== undefined) {
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

  @ApiOkResponse({ type: DaoDetailResponseDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
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

  @ApiOkResponse({ type: DaoSourceListResponseDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
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
