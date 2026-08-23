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
import { ForumSynthesisReadService } from './forum-synthesis-read.service';
import { ForumSynthesisResponseDto } from './forum-synthesis.dto';
import { toForumSynthesisResponse } from './forum-synthesis.mapper';
import { ForumThreadResponseDto } from './forum-thread.dto';

/**
 * The standalone forum-thread read surface (§6.12): `GET /v1/daos/{slug}/forum/{external_id}` and its
 * AI synthesis. Lives in the forum source's Nest package so apps/api's core stays source-blind; the
 * global problem-details filter converts the NotFoundException. `{external_id}` is the Discourse topic id.
 */
@ApiTags('Forum')
@ApiBearerAuth()
@Controller('v1/daos/:slug/forum')
export class ForumThreadController {
  constructor(
    private readonly repo: ForumThreadReadRepository,
    private readonly synthesis: ForumSynthesisReadService,
  ) {}

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

  @ApiOperation({
    summary: 'Get the AI synthesis of a forum thread',
    description:
      "A synthesis of the thread's discussion: arguments for and against, unresolved concerns, notable participants, and overall sentiment. Content-addressed by the thread's raw content — the same stored analysis the proposal route serves. Returns 404 when the thread is unknown, has no content, or has not been synthesised; a thread skipped for being non-English returns 200 with `data: null` and a reason in `_meta`.",
  })
  @Get(':external_id/ai/synthesis')
  @Header('Cache-Control', 'public, max-age=30, stale-while-revalidate=300')
  @ApiParam({ name: 'slug', type: String })
  @ApiParam({ name: 'external_id', type: String })
  @ApiOkResponse({ type: ForumSynthesisResponseDto })
  @ApiNotFoundResponse()
  async getThreadSynthesis(
    @Param('slug') slug: string,
    @Param('external_id') externalId: string,
  ): Promise<ForumSynthesisResponseDto> {
    const thread = await this.repo.getThread(slug, externalId);
    if (thread === undefined || thread.raw_content === null) {
      throw new NotFoundException(
        `No forum thread with content for dao=${slug}, external_id=${externalId}`,
      );
    }

    // null → no synthesis yet (unprocessed / budget-capped). A non-English skip is a stored row that
    // the mapper surfaces as 200 with `data: null` + `_meta.skipped_reason` (SPEC §5.7).
    const output = await this.synthesis.findForContent(thread.raw_content);
    if (output === null) {
      throw new NotFoundException(`No forum synthesis for dao=${slug}, external_id=${externalId}`);
    }

    return toForumSynthesisResponse(output);
  }
}
