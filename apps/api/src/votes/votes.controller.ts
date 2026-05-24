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
import { ProposalReadRepository, VoteReadRepository } from '@libs/db';
import { VoteDetailResponseDto, VoteListResponseDto } from './vote.dto';
import { toVoteDetailDto, toVoteListItemDto } from './vote.mappers';
import { VOTE_QUERY } from './vote.query';
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

@ApiTags('votes')
@ApiBearerAuth()
@Controller('v1/daos/:slug/proposals/:source_type/:source_id/votes')
export class VotesController {
  constructor(
    private readonly voteRepo: VoteReadRepository,
    private readonly proposalRepo: ProposalReadRepository,
    private readonly routing: ActorRoutingService,
  ) {}

  @Get()
  @CacheControl({ visibility: 'public', maxAgeSecs: 60 })
  @ApiOkResponse({ type: VoteListResponseDto })
  @ApiResponse({ status: 301, description: 'Redirect to canonical voter filter' })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async list(
    @Param('slug') slug: string,
    @Param('source_type') sourceType: string,
    @Param('source_id') sourceId: string,
    @Query() rawQuery: ApiListQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VoteListResponseDto | undefined> {
    const found = await this.proposalRepo.findOneWithDao(slug, sourceType, sourceId);
    if (found === undefined) {
      throw problemException('not-found', {
        detail: `No proposal found for dao=${slug}, source_type=${sourceType}, source_id=${sourceId}`,
      });
    }

    const query = rawQuery as Record<string, unknown>;
    const parsed = parseQuery(query, VOTE_QUERY);
    const limit = parseLimit(query['limit']);

    let voterActorId: string | undefined;
    if (typeof query['voter'] === 'string') {
      const resolved = await this.routing.resolveAddress(query['voter']);
      if (resolved.kind === 'redirect') {
        res.status(301);
        res.setHeader(
          'Location',
          `/v1/daos/${slug}/proposals/${sourceType}/${sourceId}/votes?voter=${resolved.survivorPrimaryAddress}`,
        );
        return undefined;
      }
      if (resolved.kind === 'not-found') {
        return {
          data: [],
          pagination: { limit, has_more: false, next_cursor: null },
        };
      }
      voterActorId = resolved.actor.id;
      delete parsed.filters['voter'];
    }

    const cursorRaw = typeof query['cursor'] === 'string' ? query['cursor'] : undefined;
    const cursor = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw);
    if (cursor !== undefined) {
      assertCursorMatchesQuery(cursor, parsed);
    }

    const canonical = canonicalQuery(parsed);
    let qb = this.voteRepo.listBaseQuery().where('vote.proposal_id', '=', found.proposal.id);
    if (voterActorId !== undefined) {
      qb = qb.where('vote.voter_actor_id', '=', voterActorId);
    }

    const rows = await applyQuery(qb, parsed, VOTE_QUERY, limit, cursor).execute();
    const sort = parsed.sort[0] ?? VOTE_QUERY.defaultSort[0];
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
      data: page.data.map(toVoteListItemDto),
      pagination: page.pagination,
    };
  }

  @Get(':voter_address')
  @CacheControl({ visibility: 'public', maxAgeSecs: 60 })
  @ApiOkResponse({ type: VoteDetailResponseDto })
  @ApiResponse({ status: 301, description: 'Redirect to canonical voter address' })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async detail(
    @Param('slug') slug: string,
    @Param('source_type') sourceType: string,
    @Param('source_id') sourceId: string,
    @Param('voter_address') voterAddress: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VoteDetailResponseDto | undefined> {
    const found = await this.proposalRepo.findOneWithDao(slug, sourceType, sourceId);
    if (found === undefined) {
      throw problemException('not-found', {
        detail: `No proposal found for dao=${slug}, source_type=${sourceType}, source_id=${sourceId}`,
      });
    }

    const resolved = await this.routing.resolveAddress(voterAddress);
    if (resolved.kind === 'redirect') {
      res.status(301);
      res.setHeader(
        'Location',
        `/v1/daos/${slug}/proposals/${sourceType}/${sourceId}/votes/${resolved.survivorPrimaryAddress}`,
      );
      return undefined;
    }

    if (resolved.kind === 'not-found') {
      throw problemException('actor-not-found', {
        detail: `No actor found for address ${voterAddress.toLowerCase()}`,
      });
    }

    const vote = await this.voteRepo.findOneByVoter(found.proposal.id, resolved.actor.id);
    if (vote === undefined) {
      throw problemException('not-found', {
        detail: `No vote found for proposal=${found.proposal.id}, voter_actor_id=${resolved.actor.id}`,
      });
    }

    const choices = await this.voteRepo.findChoicesForVote(vote.id);
    return {
      data: toVoteDetailDto(vote, choices),
    };
  }
}
