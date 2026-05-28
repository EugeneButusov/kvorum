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
import { ProposalReadRepository } from '@libs/db';
import { ActorProposalListResponseDto } from './actor-proposal.dto';
import { toActorProposalListItemDto } from './actor-proposal.mappers';
import { ACTOR_PROPOSAL_QUERY } from './actor-proposal.query';
import { ActorRoutingService } from './actor-routing.service';
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
@Controller('v1/actors/:address/proposals')
export class ActorProposalsController {
  constructor(
    private readonly proposalRepo: ProposalReadRepository,
    private readonly routing: ActorRoutingService,
  ) {}

  @Get()
  @CacheControl({ visibility: 'public', maxAgeSecs: 15, staleWhileRevalidateSecs: 300 })
  @ApiOkResponse({ type: ActorProposalListResponseDto })
  @ApiResponse({ status: 301, description: 'Redirect to canonical actor address' })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async list(
    @Param('address') rawAddress: string,
    @Query() rawQuery: ApiListQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ActorProposalListResponseDto | undefined> {
    const resolved = await this.routing.resolveAddress(rawAddress);
    if (resolved.kind === 'redirect') {
      res.status(301);
      res.setHeader('Location', `/v1/actors/${resolved.survivorPrimaryAddress}/proposals`);
      return undefined;
    }
    if (resolved.kind === 'not-found') {
      throw problemException('actor-not-found', {
        detail: `No actor found for address ${rawAddress.toLowerCase()}`,
      });
    }

    const query = rawQuery as Record<string, unknown>;
    const parsed = parseQuery(query, ACTOR_PROPOSAL_QUERY);
    const limit = parseLimit(query['limit']);
    const cursorRaw = typeof query['cursor'] === 'string' ? query['cursor'] : undefined;
    const cursor = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw);
    if (cursor !== undefined) {
      assertCursorMatchesQuery(cursor, parsed);
    }

    const canonical = canonicalQuery(parsed);
    const rows = await applyQuery(
      this.proposalRepo.listBaseQuery().where('proposal.proposer_actor_id', '=', resolved.actor.id),
      parsed,
      ACTOR_PROPOSAL_QUERY,
      limit,
      cursor,
    ).execute();

    const sort = parsed.sort[0] ?? ACTOR_PROPOSAL_QUERY.defaultSort[0];
    const page = buildPagination(rows, limit, (row) => ({
      type: 'time',
      value:
        sort?.field === 'voting_starts_at'
          ? row.voting_starts_at === null
            ? sort?.dir === 'asc'
              ? 'infinity'
              : '-infinity'
            : new Date(row.voting_starts_at).toISOString()
          : new Date(row.created_at).toISOString(),
      tiebreak: row.id,
      dir: sort?.dir ?? 'desc',
      q: canonical,
    }));

    return {
      data: page.data.map(toActorProposalListItemDto),
      pagination: page.pagination,
    };
  }
}
