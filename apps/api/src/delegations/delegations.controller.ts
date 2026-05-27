import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { DaoReadRepository, DelegationReadRepository } from '@libs/db';
import {
  ActorDelegationResponseDto,
  CurrentDelegatorsResponseDto,
  DelegationListResponseDto,
} from './delegation.dto';
import { toDelegationListItemDto } from './delegation.mappers';
import { DELEGATION_QUERY } from './delegation.query';
import { ActorRoutingService } from '../actors/actor-routing.service';
import { CacheControl } from '../cache/cache-control.decorator';
import { problemException } from '../http/problem-exception';
import { ProblemDto } from '../openapi/openapi.dto';
import { ApiListQueryDto } from '../openapi/query.dto';
import {
  assertCursorMatchesQuery,
  buildPagination,
  canonicalQuery,
  type CursorPayload,
  decodeCursor,
  parseLimit,
} from '../pagination/cursor';
import { parseQuery } from '../query/query-parser';

@ApiTags('delegations')
@ApiBearerAuth()
@Controller('v1/daos/:slug')
export class DelegationsController {
  constructor(
    private readonly delegationRepo: DelegationReadRepository,
    private readonly daoRepo: DaoReadRepository,
    private readonly routing: ActorRoutingService,
  ) {}

  @Get('delegations')
  @CacheControl({ visibility: 'public', maxAgeSecs: 15, staleWhileRevalidateSecs: 300 })
  @ApiOkResponse({ type: DelegationListResponseDto })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async list(@Param('slug') slug: string, @Query() rawQuery: ApiListQueryDto) {
    const dao = await this.daoRepo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const query = rawQuery as Record<string, unknown>;
    const parsed = parseQuery(query, DELEGATION_QUERY);
    const limit = parseLimit(query['limit']);
    const cursorRaw = typeof query['cursor'] === 'string' ? query['cursor'] : undefined;
    const cursor = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw);
    if (cursor !== undefined) {
      assertCursorMatchesQuery(cursor, parsed);
    }

    const canonical = canonicalQuery(parsed);
    const rows = await this.delegationRepo.listForDao({
      daoId: dao.id,
      delegatorAddress:
        typeof parsed.filters.delegator?.value === 'string'
          ? parsed.filters.delegator.value
          : undefined,
      delegateAddress:
        typeof parsed.filters.delegate?.value === 'string'
          ? parsed.filters.delegate.value
          : undefined,
      fromBlockMin:
        typeof parsed.filters.from_block_min?.value === 'string'
          ? parsed.filters.from_block_min.value
          : undefined,
      fromBlockMax:
        typeof parsed.filters.from_block_max?.value === 'string'
          ? parsed.filters.from_block_max.value
          : undefined,
    });

    const sort = parsed.sort[0] ?? DELEGATION_QUERY.defaultSort[0];
    const sortedRows = [...rows].sort((a, b) =>
      compareDelegationRows(a, b, sort?.field, sort?.dir),
    );
    const pagedRows =
      cursor === undefined ? sortedRows : sortedRows.filter((row) => isAfterCursor(row, cursor));
    const page = buildPagination(pagedRows, limit, (row) => ({
      type: sort?.field === 'block_number' ? 'bigint' : 'time',
      value:
        sort?.field === 'block_number' ? row.block_number : new Date(row.created_at).toISOString(),
      tiebreak: row.id,
      dir: sort?.dir ?? 'desc',
      q: canonical,
    }));

    return {
      data: page.data.map(toDelegationListItemDto),
      pagination: page.pagination,
    };
  }

  @Get('delegates/:delegate_address/current')
  @CacheControl({ visibility: 'public', maxAgeSecs: 15, staleWhileRevalidateSecs: 300 })
  @ApiOkResponse({ type: CurrentDelegatorsResponseDto })
  @ApiResponse({ status: 301, description: 'Redirect to canonical delegate address' })
  @ApiQuery({ name: 'as_of_block_number', required: false, type: String })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async current(
    @Param('slug') slug: string,
    @Param('delegate_address') delegateAddress: string,
    @Query() rawQuery: ApiListQueryDto & { as_of_block_number?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<CurrentDelegatorsResponseDto | undefined> {
    const dao = await this.daoRepo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const resolved = await this.routing.resolveAddress(delegateAddress, 'delegations.current');
    if (resolved.kind === 'redirect') {
      res.status(301);
      res.setHeader(
        'Location',
        `/v1/daos/${slug}/delegates/${resolved.survivorPrimaryAddress}/current`,
      );
      return undefined;
    }
    if (resolved.kind === 'not-found') {
      throw problemException('actor-not-found', {
        detail: `No actor found for address ${delegateAddress.toLowerCase()}`,
      });
    }

    const limit = parseLimit((rawQuery as Record<string, unknown>)['limit']);
    const cursorRaw = typeof rawQuery.cursor === 'string' ? rawQuery.cursor : undefined;
    const cursor = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw);
    const asOf =
      typeof rawQuery.as_of_block_number === 'string'
        ? rawQuery.as_of_block_number
        : ((await this.delegationRepo.currentConfirmedHead(dao.id)) ?? '0');

    const rows = await this.delegationRepo.currentDelegators(
      dao.id,
      resolved.actor.id,
      asOf,
      limit,
      cursor?.tiebreak == null ? undefined : String(cursor.tiebreak),
    );

    const page = buildPagination(rows, limit, (row) => ({
      type: 'bigint',
      value: row.block_number,
      tiebreak: row.delegator_address,
      dir: 'asc',
      q: 'current_delegators_v1',
    }));

    return {
      data: page.data.map(toDelegationListItemDto),
      pagination: page.pagination,
      _meta: { as_of_block_number: asOf },
    };
  }

  @Get('actors/:address/delegation')
  @CacheControl({ visibility: 'private', maxAgeSecs: 0, mustRevalidate: true })
  @ApiOkResponse({ type: ActorDelegationResponseDto })
  @ApiResponse({ status: 301, description: 'Redirect to canonical actor address' })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async actorDelegation(
    @Param('slug') slug: string,
    @Param('address') address: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ActorDelegationResponseDto | undefined> {
    const dao = await this.daoRepo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const resolved = await this.routing.resolveAddress(address, 'delegations.actor');
    if (resolved.kind === 'redirect') {
      res.status(301);
      res.setHeader(
        'Location',
        `/v1/daos/${slug}/actors/${resolved.survivorPrimaryAddress}/delegation`,
      );
      return undefined;
    }
    if (resolved.kind === 'not-found') {
      throw problemException('actor-not-found', {
        detail: `No actor found for address ${address.toLowerCase()}`,
      });
    }

    const row = await this.delegationRepo.findCurrentDelegationForActor(dao.id, resolved.actor.id);
    return { data: row === undefined ? null : toDelegationListItemDto(row) };
  }
}

function compareDelegationRows(
  a: { id: string; block_number: string; created_at: Date },
  b: { id: string; block_number: string; created_at: Date },
  field: string | undefined,
  dir: 'asc' | 'desc' | undefined,
): number {
  const direction = dir === 'asc' ? 1 : -1;
  const primary =
    field === 'created_at'
      ? a.created_at.getTime() - b.created_at.getTime()
      : compareBigintStrings(a.block_number, b.block_number);
  if (primary !== 0) return primary * direction;
  return a.id.localeCompare(b.id) * direction;
}

function isAfterCursor(
  row: { id: string; block_number: string; created_at: Date },
  cursor: CursorPayload,
): boolean {
  if (cursor.type === 'bigint') {
    const valueCmp = compareBigintStrings(row.block_number, String(cursor.value));
    if (valueCmp !== 0) return cursor.dir === 'asc' ? valueCmp > 0 : valueCmp < 0;
    const tieCmp = row.id.localeCompare(String(cursor.tiebreak));
    return cursor.dir === 'asc' ? tieCmp > 0 : tieCmp < 0;
  }

  const rowTime = row.created_at.toISOString();
  const cursorTime = String(cursor.value);
  const valueCmp = rowTime.localeCompare(cursorTime);
  if (valueCmp !== 0) return cursor.dir === 'asc' ? valueCmp > 0 : valueCmp < 0;
  const tieCmp = row.id.localeCompare(String(cursor.tiebreak));
  return cursor.dir === 'asc' ? tieCmp > 0 : tieCmp < 0;
}

function compareBigintStrings(a: string, b: string): number {
  const left = BigInt(a);
  const right = BigInt(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
