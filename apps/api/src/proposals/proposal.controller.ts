import { Controller, Get, Param, Query } from '@nestjs/common';
import { DaoReadRepository, ProposalReadRepository } from '@libs/db';
import { toProposalDetailDto, toProposalListItemDto } from './proposal.mappers';
import { CROSS_DAO_PROPOSAL_QUERY, PER_DAO_PROPOSAL_QUERY } from './proposal.query';
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

@Controller('v1')
export class ProposalController {
  constructor(
    private readonly repo: ProposalReadRepository,
    private readonly daoRepo: DaoReadRepository,
  ) {}

  @Get('daos/:slug/proposals')
  @CacheControl({ visibility: 'public', maxAgeSecs: 60 })
  async listByDao(@Param('slug') slug: string, @Query() rawQuery: Record<string, unknown>) {
    const dao = await this.daoRepo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const parsed = parseQuery(rawQuery, PER_DAO_PROPOSAL_QUERY);
    const limit = parseLimit(rawQuery['limit']);
    const cursorRaw = typeof rawQuery['cursor'] === 'string' ? rawQuery['cursor'] : undefined;
    const cursor = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw);
    if (cursor !== undefined) {
      // ADR-044: conflicting cursor/query params are a 400 cursor-parameter-mismatch.
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

  @Get('daos/:slug/proposals/:source_type/:source_id')
  @CacheControl({ visibility: 'public', maxAgeSecs: 60 })
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

    const actions = await this.repo.findActions(row.id);
    const choices = await this.repo.findChoices(row.id);

    return { data: toProposalDetailDto(row, actions, choices) };
  }

  @Get('proposals')
  @CacheControl({ visibility: 'public', maxAgeSecs: 60 })
  async listCrossDao(@Query() rawQuery: Record<string, unknown>) {
    const parsed = parseQuery(rawQuery, CROSS_DAO_PROPOSAL_QUERY);
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
      CROSS_DAO_PROPOSAL_QUERY,
      limit,
      cursor,
    ).execute();

    const sort = parsed.sort[0] ?? CROSS_DAO_PROPOSAL_QUERY.defaultSort[0];
    const page = buildPagination(rows, limit, (row) => ({
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
