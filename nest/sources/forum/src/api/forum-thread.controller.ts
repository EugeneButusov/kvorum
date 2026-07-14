import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
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
@ApiTags('forum')
@ApiBearerAuth()
@Controller('v1/daos/:slug/forum')
export class ForumThreadController {
  constructor(private readonly repo: ForumThreadReadRepository) {}

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
