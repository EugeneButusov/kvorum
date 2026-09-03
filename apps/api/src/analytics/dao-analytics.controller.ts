import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AnalyticsReadRepository, DaoReadRepository } from '@libs/db';
import { toAnalyticsMeta } from './analytics-meta.dto';
import { estimateBucketCount } from './bucket';
import { ConcentrationQueryDto, ConcentrationResponseDto } from './concentration.dto';
import { toConcentrationRowDto } from './concentration.mappers';
import { CONCENTRATION_QUERY_SCHEMA } from './concentration.query';
import { DelegateAlignmentQueryDto, DelegateAlignmentResponseDto } from './delegate-alignment.dto';
import { toDelegateAlignmentPeerDto } from './delegate-alignment.mappers';
import { DELEGATE_ALIGNMENT_QUERY_SCHEMA } from './delegate-alignment.query';
import {
  DelegateLeaderboardQueryDto,
  DelegateLeaderboardResponseDto,
} from './delegate-leaderboard.dto';
import { toDelegateLeaderboardRowDto } from './delegate-leaderboard.mappers';
import { DELEGATE_LEADERBOARD_QUERY_SCHEMA } from './delegate-leaderboard.query';
import { DelegationFlowQueryDto, DelegationFlowResponseDto } from './delegation-flow.dto';
import {
  hasResolvedDelegator,
  toDelegationFlowEdgeDto,
  toDelegationFlowNodeDtos,
} from './delegation-flow.mappers';
import { DELEGATION_FLOW_QUERY_SCHEMA } from './delegation-flow.query';
import { ForumActivityQueryDto, ForumActivityResponseDto } from './forum-activity.dto';
import { toForumActivityRowDto } from './forum-activity.mappers';
import { FORUM_ACTIVITY_QUERY_SCHEMA } from './forum-activity.query';
import { ParticipationQueryDto, ParticipationResponseDto } from './participation.dto';
import { toParticipationRowDto } from './participation.mappers';
import { PARTICIPATION_QUERY_SCHEMA } from './participation.query';
import { PassRateQueryDto, PassRateResponseDto } from './proposal-pass-rate.dto';
import { toPassRateRowDto } from './proposal-pass-rate.mappers';
import { PASS_RATE_QUERY_SCHEMA } from './proposal-pass-rate.query';
import { ActorRoutingService } from '../actors/actor-routing.service';
import { CacheControl } from '../cache/cache-control.decorator';
import { badRequestProblem, problemException } from '../http/problem-exception';
import { ProblemDto } from '../openapi/openapi.dto';
import { buildPagination, canonicalQuery, decodeCursor, parseLimit } from '../pagination/cursor';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('v1/daos/:slug/analytics')
export class DaoAnalyticsController {
  constructor(
    private readonly repo: AnalyticsReadRepository,
    private readonly daoRepo: DaoReadRepository,
    private readonly routing: ActorRoutingService,
  ) {}

  @ApiOperation({
    summary: 'Get proposal pass rate over time',
    description:
      "The share of a DAO's proposals that passed, bucketed over a time window. Use it to see whether a DAO's proposals are becoming more or less likely to succeed. Narrowable to a single proposal type.",
  })
  @Get('proposal-pass-rate')
  @CacheControl({ visibility: 'public', maxAgeSecs: 60, staleWhileRevalidateSecs: 3600 })
  @ApiOkResponse({ type: PassRateResponseDto })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async passRate(
    @Param('slug') slug: string,
    @Query() raw: PassRateQueryDto,
  ): Promise<PassRateResponseDto> {
    const dao = await this.daoRepo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const parsed = PASS_RATE_QUERY_SCHEMA.safeParse(raw);
    if (!parsed.success) throw validationFromZod(parsed.error.issues[0]);

    const query = parsed.data;
    const rows = await this.repo.passRateByBucket({
      daoId: dao.id,
      bucket: query.bucket ?? 'monthly',
      from: query.from,
      to: query.to,
      proposalType: query.proposal_type,
    });

    return {
      data: rows.map(toPassRateRowDto),
      _meta: { confirmed: true, derived_through: null },
    };
  }

  @ApiOperation({
    summary: 'Get participation rate over time',
    description:
      'The share of eligible voting power that actually voted, bucketed over a time window. Computed per proposal as cast VP / eligible VP, then averaged per bucket. Only proposals with eligible VP data contribute.',
  })
  @Get('participation')
  @CacheControl({ visibility: 'public', maxAgeSecs: 60, staleWhileRevalidateSecs: 3600 })
  @ApiOkResponse({ type: ParticipationResponseDto })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async participation(
    @Param('slug') slug: string,
    @Query() raw: ParticipationQueryDto,
  ): Promise<ParticipationResponseDto> {
    const dao = await this.daoRepo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const parsed = PARTICIPATION_QUERY_SCHEMA.safeParse(raw);
    if (!parsed.success) throw validationFromZod(parsed.error.issues[0]);

    const query = parsed.data;
    const rows = await this.repo.participationByBucket({
      daoId: dao.id,
      bucket: query.bucket ?? 'monthly',
      from: query.from,
      to: query.to,
      proposalType: query.proposal_type,
    });

    return {
      data: rows.map(toParticipationRowDto),
      _meta: { confirmed: true, derived_through: null },
    };
  }

  @ApiOperation({
    summary: 'Get voting-power concentration',
    description:
      "How concentrated a DAO's voting power is over time — the share held by the largest holders, bucketed across the window. Returns 204 when no power-bearing delegation exists anywhere in the window.",
  })
  @Get('concentration')
  @CacheControl({ visibility: 'public', maxAgeSecs: 60, staleWhileRevalidateSecs: 3600 })
  @ApiOkResponse({ type: ConcentrationResponseDto })
  @ApiResponse({
    status: 204,
    description: 'No power-bearing delegation events in the requested window',
  })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async concentration(
    @Param('slug') slug: string,
    @Query() raw: ConcentrationQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ConcentrationResponseDto | undefined> {
    const dao = await this.daoRepo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const parsed = CONCENTRATION_QUERY_SCHEMA.safeParse(raw);
    if (!parsed.success) throw validationFromZod(parsed.error.issues[0]);

    const bucket = parsed.data.bucket ?? 'monthly';
    const to = parsed.data.to ?? new Date();
    const from = parsed.data.from ?? (await this.repo.findEarliestDelegationEventAt(dao.id)) ?? to;
    if (estimateBucketCount(from, to, bucket) > 1000) {
      throw badRequestProblem('validation', [
        { field: 'from', message: 'time range is too large for selected bucket' },
      ]);
    }

    const result = await this.repo.concentrationByBucket({ daoId: dao.id, from, to, bucket });

    // ADR-061 rule 8: return 204 when the entire window has no power-bearing delegation.
    // Window-level gate — individual zero-power buckets inside a power-bearing window are
    // returned unchanged (Compound carries delegate_changed rows with voting_power='0').
    const hasPower = result.rows.some((r) => BigInt(r.total_voting_power) > 0n);
    if (!hasPower) {
      res.status(204);
      return undefined;
    }

    return {
      data: result.rows.map(toConcentrationRowDto),
      _meta: toAnalyticsMeta(result.mirrorLastEtl),
    };
  }

  @ApiOperation({
    summary: 'Get the delegation graph',
    description:
      'Delegation as a graph for the window: nodes are addresses, edges are delegations weighted by the power moved. Use `min_voting_power` to drop noise. An edge whose endpoint has no known actor is still returned — an undelegation to the zero address, for example — it simply contributes no node.',
  })
  @Get('delegation-flow')
  @CacheControl({ visibility: 'public', maxAgeSecs: 60, staleWhileRevalidateSecs: 3600 })
  @ApiOkResponse({ type: DelegationFlowResponseDto })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async delegationFlow(
    @Param('slug') slug: string,
    @Query() raw: DelegationFlowQueryDto,
  ): Promise<DelegationFlowResponseDto> {
    const dao = await this.daoRepo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const parsed = DELEGATION_FLOW_QUERY_SCHEMA.safeParse(raw);
    if (!parsed.success) throw validationFromZod(parsed.error.issues[0]);

    const now = new Date();
    const to = parsed.data.to ?? now;
    const from = parsed.data.from ?? new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
    const minVotingPowerWei =
      parsed.data.min_voting_power === undefined ? undefined : BigInt(parsed.data.min_voting_power);

    const result = await this.repo.delegationFlowEdges({
      daoId: dao.id,
      from,
      to,
      minVotingPowerWei,
    });

    // An endpoint can be null when its address has no actor — most often the delegate end of an
    // undelegation (delegating to address(0)). Those edges still render; they just contribute no node.
    const edges = result.rows.filter(hasResolvedDelegator);
    const actorIds = [
      ...new Set(
        edges
          .flatMap((row) => [row.delegator_actor_id, row.delegate_actor_id])
          .filter((id): id is string => id !== null),
      ),
    ];
    const powers = await this.repo.currentVotingPowerByActor(dao.id, actorIds);
    const actors = await this.repo.findActors(actorIds);
    const actorsById = new Map(actors.map((a) => [a.id, a]));

    return {
      nodes: toDelegationFlowNodeDtos({ powers, actorsById }),
      edges: edges.map(toDelegationFlowEdgeDto),
      _meta: toAnalyticsMeta(result.mirrorLastEtl),
    };
  }

  @ApiOperation({
    summary: 'Get the delegate leaderboard',
    description:
      "A DAO's delegates ranked by current voting power, with the number of delegators behind each.",
  })
  @Get('delegates')
  @CacheControl({ visibility: 'public', maxAgeSecs: 60, staleWhileRevalidateSecs: 3600 })
  @ApiOkResponse({ type: DelegateLeaderboardResponseDto })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async delegateLeaderboard(
    @Param('slug') slug: string,
    @Query() raw: DelegateLeaderboardQueryDto,
  ): Promise<DelegateLeaderboardResponseDto> {
    const dao = await this.daoRepo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const parsed = DELEGATE_LEADERBOARD_QUERY_SCHEMA.safeParse(raw);
    if (!parsed.success) throw validationFromZod(parsed.error.issues[0]);

    const limit = parsed.data.limit ?? 25;
    const { rows, totalVotingPower } = await this.repo.delegateLeaderboard({
      daoId: dao.id,
      limit,
    });
    const actors = await this.repo.findActors(rows.map((r) => r.actor_id));
    const actorById = new Map(actors.map((a) => [a.id, a]));

    return {
      data: rows.map((row, i) =>
        toDelegateLeaderboardRowDto(row, i + 1, totalVotingPower, actorById.get(row.actor_id)),
      ),
      _meta: { confirmed: true, derived_through: null },
    };
  }

  @ApiOperation({
    summary: 'Get delegate voting alignment',
    description:
      'How often a delegate votes the same way as its peers, over a window. Use it to spot delegates that consistently vote with — or against — the rest of the delegate set.',
  })
  @Get('delegate-alignment')
  @CacheControl({ visibility: 'public', maxAgeSecs: 60, staleWhileRevalidateSecs: 3600 })
  @ApiOkResponse({ type: DelegateAlignmentResponseDto })
  @ApiResponse({ status: 301, description: 'Redirect to canonical delegate filter' })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async delegateAlignment(
    @Param('slug') slug: string,
    @Query() raw: DelegateAlignmentQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DelegateAlignmentResponseDto | undefined> {
    const dao = await this.daoRepo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const parsed = DELEGATE_ALIGNMENT_QUERY_SCHEMA.safeParse(raw);
    if (!parsed.success) throw validationFromZod(parsed.error.issues[0]);

    const limit = parseLimit(raw.limit);
    const cursorRaw = raw.cursor;
    const sortRaw = raw.sort ?? '-vote_count';
    const sortField = sortRaw.includes('alignment_score') ? 'alignment_score' : 'vote_count';
    const dir = sortRaw.startsWith('-') ? 'desc' : 'asc';
    const queryCanonical = canonicalQuery({
      filters: {
        delegate: {
          field: 'delegate',
          column: 'delegate',
          op: 'eq',
          value: parsed.data.delegate.toLowerCase(),
          multi: false,
        },
      },
      sort: [
        {
          field: sortField,
          column: sortField,
          dir,
          nullable: false,
        },
      ],
    });

    const routing = await this.routing.resolveAddress(parsed.data.delegate.toLowerCase());
    if (routing.kind === 'redirect') {
      res.status(301);
      res.setHeader(
        'Location',
        `/v1/daos/${slug}/analytics/delegate-alignment?delegate=${routing.survivorPrimaryAddress}`,
      );
      return undefined;
    }
    if (routing.kind === 'not-found') {
      throw problemException('actor-not-found', {
        detail: `No actor found for address ${parsed.data.delegate.toLowerCase()}`,
      });
    }

    const cursor = cursorRaw ? decodeCursor(cursorRaw) : undefined;
    if (cursor && cursor.q !== queryCanonical) {
      throw badRequestProblem('cursor-parameter-mismatch', [
        { field: 'cursor', message: 'cursor does not match the request filters/sort' },
      ]);
    }

    const result = await this.repo.delegateAlignmentPage({
      daoId: dao.id,
      focalActorId: routing.actor.id,
      limit,
      from: parsed.data.from,
      to: parsed.data.to,
      sort: sortField,
      dir,
    });

    const actorIds = result.rows.map((row) => row.peer_actor_id);
    const actors = await this.repo.findActors(actorIds);
    const actorById = new Map(actors.map((a) => [a.id, a]));

    const page = buildPagination(result.rows, limit, (row) => ({
      type: 'numeric',
      value: row.vote_count,
      // Must match the query's ORDER BY tiebreak, which is now the canonical peer address rather
      // than the actor id — otherwise a cursor resumes from a key the ranking does not sort on.
      tiebreak: row.peer_address,
      dir,
      q: queryCanonical,
    }));

    return {
      focal_delegate: {
        actor_id: routing.actor.id,
        address: routing.actor.primary_address,
        display_name: routing.actor.display_name,
      },
      peers: page.data.map((row) =>
        toDelegateAlignmentPeerDto(row, actorById.get(row.peer_actor_id)),
      ),
      pagination: page.pagination,
      _meta: toAnalyticsMeta(result.mirrorLastEtl),
    };
  }

  @ApiOperation({
    summary: 'Get forum activity over time',
    description:
      "Forum post volume for a DAO's Discourse governance category, bucketed over a time window. Derived from crawled thread data in the archive.",
  })
  @Get('forum-activity')
  @CacheControl({ visibility: 'public', maxAgeSecs: 60, staleWhileRevalidateSecs: 3600 })
  @ApiOkResponse({ type: ForumActivityResponseDto })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async forumActivity(
    @Param('slug') slug: string,
    @Query() raw: ForumActivityQueryDto,
  ): Promise<ForumActivityResponseDto> {
    const dao = await this.daoRepo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const parsed = FORUM_ACTIVITY_QUERY_SCHEMA.safeParse(raw);
    if (!parsed.success) throw validationFromZod(parsed.error.issues[0]);

    const query = parsed.data;
    const rows = await this.repo.forumActivityByBucket({
      daoId: dao.id,
      bucket: query.bucket ?? 'weekly',
      from: query.from,
      to: query.to,
    });

    return {
      data: rows.map(toForumActivityRowDto),
      _meta: { confirmed: true, derived_through: null },
    };
  }
}

function validationFromZod(issue: unknown) {
  let field = 'query';
  let message = 'Invalid query';
  if (typeof issue === 'object' && issue !== null) {
    const maybePath = (issue as { path?: unknown }).path;
    const maybeMessage = (issue as { message?: unknown }).message;
    if (Array.isArray(maybePath)) {
      field = maybePath
        .filter(
          (part): part is string | number => typeof part === 'string' || typeof part === 'number',
        )
        .join('.');
    }
    if (typeof maybeMessage === 'string' && maybeMessage.length > 0) {
      message = maybeMessage;
    }
  }
  return badRequestProblem('validation', [
    {
      field,
      message,
    },
  ]);
}
