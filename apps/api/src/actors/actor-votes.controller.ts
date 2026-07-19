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
import { ProposalReadRepository, VoteReadRepository, type VoteReadRow } from '@libs/db';
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
  sortAndSeek,
} from '../pagination/cursor';
import { parseQuery } from '../query/query-parser';

@ApiTags('actors')
@ApiBearerAuth()
@Controller('v1/actors/:address/votes')
export class ActorVotesController {
  constructor(
    private readonly voteRepo: VoteReadRepository,
    private readonly routing: ActorRoutingService,
    private readonly proposalRepo: ProposalReadRepository,
  ) {}

  /**
   * The proposal's own label for each vote's choice ("for", "Option A", …), keyed by vote id.
   *
   * A vote carries only a numeric `primary_choice`; the label lives on the proposal it was cast on.
   * Resolved here in one batched read for the page — an actor's votes span many proposals, so doing
   * it per row would be an N+1, and leaving it to the client would make it fetch every proposal.
   * Null when the proposal declares no choice at that index: the client falls back rather than
   * being handed an invented label.
   */
  private async choiceLabelsByVote(
    rows: readonly VoteReadRow[],
  ): Promise<Map<string, string | null>> {
    const proposalIds = [...new Set(rows.map((row) => row.proposal_id))];
    const choicesByProposal = await this.proposalRepo.findChoicesForProposals(proposalIds);

    return new Map(
      rows.map((row) => [
        row.id,
        row.primary_choice === null
          ? null
          : (choicesByProposal
              .get(row.proposal_id)
              ?.find((choice) => choice.choice_index === row.primary_choice)?.value ?? null),
      ]),
    );
  }

  @Get()
  @CacheControl({ visibility: 'public', maxAgeSecs: 15, staleWhileRevalidateSecs: 300 })
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
    const rows = await this.voteRepo.listForActor(resolved.actor.id);

    const sort = parsed.sort[0] ?? ACTOR_VOTE_QUERY.defaultSort[0];
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
    // Seek past the incoming cursor before paginating; otherwise every page returns the first rows.
    const seeked = sortAndSeek(rows, cursor, sortKeyOf);
    const page = buildPagination(seeked, limit, sortKeyOf);

    const choiceLabels = await this.choiceLabelsByVote(page.data);
    return {
      data: page.data.map((row) => toActorVoteListItemDto(row, choiceLabels.get(row.id) ?? null)),
      pagination: page.pagination,
    };
  }
}
