import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DaoReadRepository } from '@libs/db';
import { toAnalyticsMeta } from './analytics-meta.dto';
import { AnalyticsReadRepository } from './analytics-read-repository';
import { PassRateQueryDto, PassRateResponseDto } from './proposal-pass-rate.dto';
import { toPassRateRowDto } from './proposal-pass-rate.mappers';
import { PASS_RATE_QUERY_SCHEMA } from './proposal-pass-rate.query';
import { CacheControl } from '../cache/cache-control.decorator';
import { badRequestProblem, problemException } from '../http/problem-exception';
import { ProblemDto } from '../openapi/openapi.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('v1/daos/:slug/analytics')
export class DaoAnalyticsController {
  constructor(
    private readonly repo: AnalyticsReadRepository,
    private readonly daoRepo: DaoReadRepository,
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
    if (!parsed.success) {
      throw badRequestProblem('validation', [
        {
          field: parsed.error.issues[0]?.path.join('.') || 'query',
          message: parsed.error.issues[0]?.message || 'Invalid query',
        },
      ]);
    }

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
      _meta: toAnalyticsMeta(null),
    };
  }
}
