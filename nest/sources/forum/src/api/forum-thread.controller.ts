import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ForumThreadReadRepository } from '@sources/forum';
import { ForumThreadResponseDto } from './forum-thread.dto';

/**
 * The standalone forum-thread read surface (§6.12): `GET /v1/daos/{slug}/forum/{external_id}`. Lives
 * in the forum source's Nest package so apps/api's core stays source-blind; the global problem-details
 * filter converts the NotFoundException. `{external_id}` is the Discourse topic id.
 */
@ApiTags('Forum')
@ApiBearerAuth()
@Controller('v1/daos/:slug/forum')
export class ForumThreadController {
  constructor(private readonly repo: ForumThreadReadRepository) {}

  @ApiOperation({
    summary: 'Get a forum thread',
    description:
      "A Discourse thread linked to a DAO's governance, with its posts. `external_id` is the Discourse topic id, as reported in a proposal's off-chain discussion links.",
  })
  @Get(':external_id')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiParam({ name: 'slug', type: String })
  @ApiParam({ name: 'external_id', type: String })
  @ApiOkResponse({ type: ForumThreadResponseDto })
  @ApiNotFoundResponse()
  async getThread(
    @Param('slug') slug: string,
    @Param('external_id') externalId: string,
  ): Promise<ForumThreadResponseDto> {
    const thread = await this.repo.getThread(slug, externalId);
    if (thread === undefined) {
      throw new NotFoundException(
        `No forum thread found for dao=${slug}, external_id=${externalId}`,
      );
    }
    return { data: thread };
  }
}
