import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { VoteReadRepository } from '@libs/db';
import { ActorRoutingService } from './actor-routing.service';
import { ActorVoteListResponseDto } from './actor-vote.dto';
import { toActorVoteListItemDto } from './actor-vote.mappers';
import { ACTOR_VOTE_QUERY } from './actor-vote.query';
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

@ApiTags('actors')
@ApiBearerAuth()
@Controller('v1/actors/:address/votes')
export class ActorVotesController {
  constructor(
    private readonly voteRepo: VoteReadRepository,
    private readonly routing: ActorRoutingService,
  ) {}

  @Get()
  @CacheControl({ visibility: 'public', maxAgeSecs: 60 })
  @ApiOkResponse({ type: ActorVoteListResponseDto })
  @ApiResponse({ status: 301, description: 'Redirect to canonical actor address' })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async list(
    @Param('address') rawAddress: string,
    @Query() rawQuery: ApiListQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ActorVoteListResponseDto | undefined> {
    const resolved = await this.routing.resolveAddress(rawAddress);
    if (resolved.kind === 'redirect') {
      res.status(301);
      res.setHeader('Location', `/v1/actors/${resolved.survivorPrimaryAddress}/votes`);
      return undefined;
    }
    if (resolved.kind === 'not-found') {
      throw problemException('actor-not-found', {
        detail: `No actor found for address ${rawAddress.toLowerCase()}`,
      });
    }

    const query = rawQuery as Record<string, unknown>;
    const parsed = parseQuery(query, ACTOR_VOTE_QUERY);
    const limit = parseLimit(query['limit']);
    const cursorRaw = typeof query['cursor'] === 'string' ? query['cursor'] : undefined;
    const cursor = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw);
    if (cursor !== undefined) {
      assertCursorMatchesQuery(cursor, parsed);
    }

    const canonical = canonicalQuery(parsed);
    const rows = await applyQuery(
      this.voteRepo.listBaseQuery().where('vote.voter_actor_id', '=', resolved.actor.id),
      parsed,
      ACTOR_VOTE_QUERY,
      limit,
      cursor,
    ).execute();

    const sort = parsed.sort[0] ?? ACTOR_VOTE_QUERY.defaultSort[0];
    const page = buildPagination(rows, limit, (row) => ({
      type: sort?.field === 'voting_power_reported' ? 'numeric' : 'time',
      value:
        sort?.field === 'voting_power_reported'
          ? row.voting_power_reported
          : new Date(row.cast_at).toISOString(),
      tiebreak: row.id,
      dir: sort?.dir ?? 'desc',
      q: canonical,
    }));

    return {
      data: page.data.map(toActorVoteListItemDto),
      pagination: page.pagination,
    };
  }
}
