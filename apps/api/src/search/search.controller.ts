import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SearchResponseDto } from './search.dto';
import { SearchService, type SearchEntityType } from './search.service';
import { CacheControl } from '../cache/cache-control.decorator';
import { problemException } from '../http/problem-exception';
import { ProblemDto } from '../openapi/openapi.dto';

const VALID_TYPES = new Set<string>(['proposal', 'dao', 'actor']);

@ApiTags('Search')
@ApiBearerAuth()
@Controller('v1')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @ApiOperation({
    summary: 'Search across proposals, DAOs, and actors',
    description:
      'Full-text search with ranked results per entity type. Automatically detects hex addresses and routes to direct address lookup for actors.',
  })
  @ApiQuery({
    name: 'q',
    required: true,
    type: String,
    description: 'Search query (min 1 char, max 200)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max results per entity type (default 5, max 25)',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['proposal', 'dao', 'actor'],
    description: 'Narrow to one entity type; omit to search all',
  })
  @ApiOkResponse({ type: SearchResponseDto })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @Get('search')
  @CacheControl({ visibility: 'private', maxAgeSecs: 0, mustRevalidate: true })
  async search(
    @Query('q') q: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Query('type') type: string | undefined,
  ): Promise<SearchResponseDto> {
    if (q === undefined || q.trim().length === 0) {
      throw problemException('validation', { detail: 'q is required' });
    }

    if (type !== undefined && !VALID_TYPES.has(type)) {
      throw problemException('validation', {
        detail: `type must be one of: proposal, dao, actor`,
      });
    }

    const limit = limitRaw !== undefined ? parseInt(limitRaw, 10) : undefined;
    const result = await this.searchService.search(
      q,
      type as SearchEntityType | undefined,
      Number.isNaN(limit) ? undefined : limit,
    );

    return {
      data: {
        proposals: result.proposals.map((r) => ({
          dao_slug: r.dao_slug,
          dao_name: r.dao_name,
          source_type: r.source_type,
          source_id: r.source_id,
          title: r.title,
          state: r.state,
          voting_starts_at: r.voting_starts_at?.toISOString() ?? null,
          rank: r.rank,
        })),
        daos: result.daos.map((r) => ({
          slug: r.slug,
          name: r.name,
          description: r.description,
          rank: r.rank,
        })),
        actors: result.actors.map((r) => ({
          display_name: r.display_name,
          primary_address: r.primary_address,
          rank: r.rank,
        })),
      },
    };
  }
}
