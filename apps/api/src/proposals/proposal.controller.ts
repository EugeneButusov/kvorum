import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DaoReadRepository, ProposalReadRepository } from '@libs/db';
import { SourceApiRegistry } from '@nest/source-api';
import { ProposalDetailResponseDto, ProposalListResponseDto } from './proposal.dto';
import { toProposalDetailDto, toProposalListItemDto } from './proposal.mappers';
import { CROSS_DAO_PROPOSAL_QUERY, PER_DAO_PROPOSAL_QUERY } from './proposal.query';
import { CacheControl } from '../cache/cache-control.decorator';
import { problemException } from '../http/problem-exception';
import { ProblemDto } from '../openapi/openapi.dto';
import { ApiListQueryDto } from '../openapi/query.dto';
import {
  assertCursorMatchesQuery,
  buildPagination,
  canonicalQuery,
  decodeCursor,
  parseLimit,
} from '../pagination/cursor';
import { applyQuery } from '../query/kysely-filter';
import { parseQuery } from '../query/query-parser';

@ApiTags('proposals')
@ApiBearerAuth()
@Controller('v1')
export class ProposalController {
  constructor(
    private readonly repo: ProposalReadRepository,
    private readonly daoRepo: DaoReadRepository,
    private readonly sourceApiRegistry: SourceApiRegistry,
  ) {}

  @ApiParam({ name: 'slug', type: String })
  @ApiOkResponse({ type: ProposalListResponseDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  @Get('daos/:slug/proposals')
  @CacheControl({ visibility: 'public', maxAgeSecs: 15, staleWhileRevalidateSecs: 300 })
  async listByDao(@Param('slug') slug: string, @Query() rawQuery: ApiListQueryDto) {
    const dao = await this.daoRepo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const query = rawQuery as Record<string, unknown>;
    const parsed = parseQuery(query, PER_DAO_PROPOSAL_QUERY);
    const limit = parseLimit(query['limit']);
    const cursorRaw = typeof query['cursor'] === 'string' ? query['cursor'] : undefined;
    const cursor = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw);
    if (cursor !== undefined) {
      assertCursorMatchesQuery(cursor, parsed);
    }

    const canonical = canonicalQuery(parsed);
    const rows = await applyQuery(
      this.repo.listBaseQuery().where('dao.slug', '=', slug),
      parsed,
      PER_DAO_PROPOSAL_QUERY,
      limit,
      cursor,
    ).execute();

    const sort = parsed.sort[0] ?? PER_DAO_PROPOSAL_QUERY.defaultSort[0];
    const page = buildPagination(rows, limit, (row) => ({
      type: 'time',
      value: primarySortValue(row, sort?.field ?? 'created_at', sort?.dir ?? 'desc'),
      tiebreak: row.id,
      dir: sort?.dir ?? 'desc',
      q: canonical,
    }));

    return {
      data: page.data.map(toProposalListItemDto),
      pagination: page.pagination,
    };
  }

  @ApiParam({ name: 'slug', type: String })
  @ApiParam({ name: 'source_type', type: String })
  @ApiParam({ name: 'source_id', type: String })
  @ApiOkResponse({ type: ProposalDetailResponseDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  @Get('daos/:slug/proposals/:source_type/:source_id')
  @CacheControl({ visibility: 'private', maxAgeSecs: 0, mustRevalidate: true })
  async detail(
    @Param('slug') slug: string,
    @Param('source_type') sourceType: string,
    @Param('source_id') sourceId: string,
  ) {
    const row = await this.repo.findOne(slug, sourceType, sourceId);
    if (row === undefined) {
      throw problemException('not-found', {
        detail: `No proposal found for dao=${slug}, source_type=${sourceType}, source_id=${sourceId}`,
      });
    }

    const [actions, choices, originChainId, extension] = await Promise.all([
      this.repo.findActions(row.id),
      this.repo.findChoices(row.id),
      this.repo.resolveOriginChainId(row.id, sourceType),
      this.sourceApiRegistry.getProposalExtension(row.id, sourceType),
    ]);

    return { data: toProposalDetailDto(row, actions, choices, originChainId, extension) };
  }

  @ApiOkResponse({ type: ProposalListResponseDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @Get('proposals')
  @CacheControl({ visibility: 'public', maxAgeSecs: 15, staleWhileRevalidateSecs: 300 })
  async listCrossDao(@Query() rawQuery: ApiListQueryDto) {
    const query = rawQuery as Record<string, unknown>;
    const parsed = parseQuery(query, CROSS_DAO_PROPOSAL_QUERY);
    const limit = parseLimit(query['limit']);
    const cursorRaw = typeof query['cursor'] === 'string' ? query['cursor'] : undefined;
    const cursor = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw);
    if (cursor !== undefined) {
      assertCursorMatchesQuery(cursor, parsed);
    }

    const canonical = canonicalQuery(parsed);
    const rows = await applyQuery(
      this.repo.listBaseQuery(),
      parsed,
      CROSS_DAO_PROPOSAL_QUERY,
      limit,
      cursor,
    ).execute();

    const sort = parsed.sort[0] ?? CROSS_DAO_PROPOSAL_QUERY.defaultSort[0];
    const page = buildPagination(rows, limit, (row) => ({
      type: 'time',
      value: primarySortValue(row, sort?.field ?? 'created_at', sort?.dir ?? 'desc'),
      tiebreak: row.id,
      dir: sort?.dir ?? 'desc',
      q: canonical,
    }));

    return {
      data: page.data.map(toProposalListItemDto),
      pagination: page.pagination,
    };
  }
}

function primarySortValue(
  row: {
    voting_starts_at: Date | null;
    voting_ends_at: Date | null;
    created_at: Date;
    state_updated_at: Date;
  },
  field: string,
  dir: 'asc' | 'desc',
): string {
  if (field === 'voting_starts_at') {
    return row.voting_starts_at === null
      ? dir === 'asc'
        ? 'infinity'
        : '-infinity'
      : new Date(row.voting_starts_at).toISOString();
  }

  if (field === 'voting_ends_at') {
    return row.voting_ends_at === null
      ? dir === 'asc'
        ? 'infinity'
        : '-infinity'
      : new Date(row.voting_ends_at).toISOString();
  }

  if (field === 'state_updated_at') {
    return new Date(row.state_updated_at).toISOString();
  }

  return new Date(row.created_at).toISOString();
}
