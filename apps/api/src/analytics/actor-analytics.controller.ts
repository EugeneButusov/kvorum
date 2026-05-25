import { Controller, Get, Param, Res } from '@nestjs/common';
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
import { toAnalyticsMeta } from './analytics-meta.dto';
import { AnalyticsReadRepository } from './analytics-read-repository';
import { CrossDaoActorDto } from './cross-dao.dto';
import { toCrossDaoActorDto } from './cross-dao.mappers';
import { ActorRoutingService } from '../actors/actor-routing.service';
import { CacheControl } from '../cache/cache-control.decorator';
import { problemException } from '../http/problem-exception';
import { ProblemDto } from '../openapi/openapi.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('v1/actors/:address/analytics')
export class ActorAnalyticsController {
  constructor(
    private readonly repo: AnalyticsReadRepository,
    private readonly routing: ActorRoutingService,
  ) {}

  @Get('cross-dao')
  @CacheControl({ visibility: 'public', maxAgeSecs: 3600 })
  @ApiOkResponse({ type: CrossDaoActorDto })
  @ApiResponse({ status: 301, description: 'Redirect to canonical actor address' })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  async crossDao(
    @Param('address') rawAddress: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CrossDaoActorDto | undefined> {
    const resolved = await this.routing.resolveAddress(rawAddress);
    if (resolved.kind === 'redirect') {
      res.status(301);
      res.setHeader(
        'Location',
        `/v1/actors/${resolved.survivorPrimaryAddress}/analytics/cross-dao`,
      );
      return undefined;
    }
    if (resolved.kind === 'not-found') {
      throw problemException('actor-not-found', {
        detail: `No actor found for address ${rawAddress.toLowerCase()}`,
      });
    }

    const { rows, mirrorLastEtl } = await this.repo.crossDaoSummaryForActor(
      resolved.actor.primary_address,
    );
    const alignment = await this.repo.alignmentWithMajorityForActor(
      resolved.actor.id,
      rows.map((row) => row.dao_id),
    );
    const effectiveEtl =
      rows.length === 0 ? await this.repo.findGlobalEtlWatermark() : mirrorLastEtl;

    return toCrossDaoActorDto({
      actor: resolved.actor,
      summaries: rows,
      alignmentByDaoId: alignment,
      meta: toAnalyticsMeta(effectiveEtl),
    });
  }
}
