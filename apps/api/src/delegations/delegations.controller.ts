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
import { ActorRoutingService } from '../actors/actor-routing.service';
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
import {
  ActorDelegationResponseDto,
  CurrentDelegatorsResponseDto,
  DelegationListResponseDto,
} from './delegation.dto';
import { toDelegationListItemDto } from './delegation.mappers';
import { DELEGATION_QUERY } from './delegation.query';

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
  @CacheControl({ visibility: 'public', maxAgeSecs: 60 })
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
    const rows = await applyQuery(
      this.delegationRepo.listBaseQuery().where('delegation.dao_id', '=', dao.id),
      parsed,
      DELEGATION_QUERY,
      limit,
      cursor,
    ).execute();

    const sort = parsed.sort[0] ?? DELEGATION_QUERY.defaultSort[0];
    const page = buildPagination(rows, limit, (row) => ({
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
  @CacheControl({ visibility: 'public', maxAgeSecs: 60 })
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

    const resolved = await this.routing.resolveAddress(delegateAddress);
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
      tiebreak: row.delegator_actor_id,
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
  @CacheControl({ visibility: 'public', maxAgeSecs: 60 })
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

    const resolved = await this.routing.resolveAddress(address);
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
