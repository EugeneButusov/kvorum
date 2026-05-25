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
import { DaoReadRepository } from '@libs/db';
import { toAnalyticsMeta } from './analytics-meta.dto';
import { AnalyticsReadRepository } from './analytics-read-repository';
import { estimateBucketCount } from './bucket';
import { ConcentrationQueryDto, ConcentrationResponseDto } from './concentration.dto';
import { toConcentrationRowDto } from './concentration.mappers';
import { CONCENTRATION_QUERY_SCHEMA } from './concentration.query';
import { DelegateAlignmentQueryDto, DelegateAlignmentResponseDto } from './delegate-alignment.dto';
import { toDelegateAlignmentPeerDto } from './delegate-alignment.mappers';
import { DELEGATE_ALIGNMENT_QUERY_SCHEMA } from './delegate-alignment.query';
import { DelegationFlowQueryDto, DelegationFlowResponseDto } from './delegation-flow.dto';
import { toDelegationFlowEdgeDto, toDelegationFlowNodeDtos } from './delegation-flow.mappers';
import { DELEGATION_FLOW_QUERY_SCHEMA } from './delegation-flow.query';
import { PassRateQueryDto, PassRateResponseDto } from './proposal-pass-rate.dto';
import { toPassRateRowDto } from './proposal-pass-rate.mappers';
import { PASS_RATE_QUERY_SCHEMA } from './proposal-pass-rate.query';
import { ActorRoutingService } from '../actors/actor-routing.service';
import { CacheControl } from '../cache/cache-control.decorator';
import { badRequestProblem, problemException } from '../http/problem-exception';
import { ProblemDto } from '../openapi/openapi.dto';
import { buildPagination, canonicalQuery, decodeCursor, parseLimit } from '../pagination/cursor';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('v1/daos/:slug/analytics')
export class DaoAnalyticsController {
  constructor(
    private readonly repo: AnalyticsReadRepository,
    private readonly daoRepo: DaoReadRepository,
    private readonly routing: ActorRoutingService,
  ) {}

  @Get('proposal-pass-rate')
  @CacheControl({ visibility: 'public', maxAgeSecs: 3600 })
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
      _meta: { confirmed: true, mirror_ready: true, mirror_last_etl: null },
    };
  }

  @Get('concentration')
  @CacheControl({ visibility: 'public', maxAgeSecs: 3600 })
  @ApiOkResponse({ type: ConcentrationResponseDto })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async concentration(
    @Param('slug') slug: string,
    @Query() raw: ConcentrationQueryDto,
  ): Promise<ConcentrationResponseDto> {
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
    return {
      data: result.rows.map(toConcentrationRowDto),
      _meta: toAnalyticsMeta(result.mirrorLastEtl),
    };
  }

  @Get('delegation-flow')
  @CacheControl({ visibility: 'public', maxAgeSecs: 3600 })
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

    const actorIds = [
      ...new Set(result.rows.flatMap((row) => [row.delegator_actor_id, row.delegate_actor_id])),
    ];
    const powers = await this.repo.currentVotingPowerByActor(dao.id, actorIds);
    const actors = await this.repo.findActors(actorIds);
    const actorsById = new Map(actors.map((a) => [a.id, a]));

    return {
      nodes: toDelegationFlowNodeDtos({ powers, actorsById }),
      edges: result.rows.map(toDelegationFlowEdgeDto),
      _meta: toAnalyticsMeta(result.mirrorLastEtl),
    };
  }

  @Get('delegate-alignment')
  @CacheControl({ visibility: 'public', maxAgeSecs: 3600 })
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
      tiebreak: row.peer_actor_id,
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
