import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
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
import {
  SOURCE_READ_EXTENSIONS,
  type SourceReadExtension,
  choiceBoundsFor,
  getVoteChoicesFor,
} from '@libs/domain';
import { VoteDetailResponseDto, VoteListResponseDto } from './vote.dto';
import { toVoteDetailDto, toVoteListItemDto } from './vote.mappers';
import { VOTE_QUERY } from './vote.query';
import { ActorRoutingService } from '../actors/actor-routing.service';
import { CacheControl } from '../cache/cache-control.decorator';
import { badRequestProblem, problemException } from '../http/problem-exception';
import { ApiEndpointQuery } from '../openapi/api-endpoint-query.decorator';
import { ProblemDto } from '../openapi/openapi.dto';
import { ApiListQueryDto } from '../openapi/query.dto';
import {
  assertCursorMatchesQuery,
  buildPagination,
  canonicalQuery,
  decodeCursor,
  parseLimit,
  sortAndSeek,
} from '../pagination/cursor';
import { parseQuery } from '../query/query-parser';

@ApiTags('votes')
@ApiBearerAuth()
@Controller('v1/daos/:slug/proposals/:source_type/:source_id/votes')
export class VotesController {
  constructor(
    private readonly voteRepo: VoteReadRepository,
    private readonly proposalRepo: ProposalReadRepository,
    private readonly routing: ActorRoutingService,
    @Inject(SOURCE_READ_EXTENSIONS)
    private readonly extensions: readonly SourceReadExtension[],
  ) {}

  @ApiEndpointQuery(VOTE_QUERY)
  @Get()
  @CacheControl({ visibility: 'public', maxAgeSecs: 15, staleWhileRevalidateSecs: 300 })
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
    const primaryChoices =
      parsed.filters['primary_choice']?.value == null
        ? undefined
        : (parsed.filters['primary_choice'].value as number[]);

    // Validate the primary_choice filter INPUT against the source's choice bounds
    // (input validation, not stored-value re-verification).
    if (primaryChoices !== undefined) {
      const { min, max } = choiceBoundsFor(this.extensions, sourceType);
      const outOfRange = primaryChoices.filter((c) => c < min || c > max);
      if (outOfRange.length > 0) {
        throw badRequestProblem(
          'validation',
          [
            {
              field: 'primary_choice',
              message: `choice index must be in [${min}, ${max}] for source ${sourceType}`,
            },
          ],
          `Invalid primary_choice value(s): ${outOfRange.join(', ')}`,
        );
      }
    }

    const rows = await this.voteRepo.listForProposal({
      proposalId: found.proposal.id,
      voterActorId,
      primaryChoices,
    });
    const sort = parsed.sort[0] ?? VOTE_QUERY.defaultSort[0];
    const sortKeyOf = (row: (typeof rows)[number]) => ({
      type: (sort?.field === 'voting_power_reported' ? 'numeric' : 'time') as 'numeric' | 'time',
      value:
        sort?.field === 'voting_power_reported'
          ? row.voting_power_reported
          : new Date(row.cast_at).toISOString(),
      tiebreak: row.id,
      dir: (sort?.dir ?? 'desc') as 'asc' | 'desc',
      q: canonical,
    });
    // Apply the incoming cursor (sort + seek past its position) before paginating; without this the
    // cursor is ignored and every page returns the first `limit` rows (infinite loop).
    const seeked = sortAndSeek(rows, cursor, sortKeyOf);
    const page = buildPagination(seeked, limit, sortKeyOf);

    return {
      data: page.data.map(toVoteListItemDto),
      pagination: page.pagination,
    };
  }

  @Get(':voter_address')
  @CacheControl({ visibility: 'private', maxAgeSecs: 0, mustRevalidate: true })
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

    // Prefer the source's own breakdown (e.g. Snapshot multiplicity); fall back to the source-agnostic
    // synthesis from primary_choice when the source carries none.
    const sourceChoices = await getVoteChoicesFor(this.extensions, vote.id, sourceType);
    const choices = sourceChoices ?? (await this.voteRepo.findChoicesForVote(vote.id));
    return {
      data: toVoteDetailDto(vote, choices),
    };
  }
}
