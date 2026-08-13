import { Controller, Get, Inject, Optional, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { EMBEDDING_VERSION } from '@libs/ai';
import { DaoReadRepository, ProposalReadRepository, VoteReadRepository } from '@libs/db';
import {
  SOURCE_READ_EXTENSIONS,
  getOffchainDiscussionContentFor,
  getProposalExtensionFor,
  type SourceReadExtension,
} from '@libs/domain';
import { AiSummaryReadService } from './ai-summary-read.service';
import { ForumSynthesisReadService } from './forum-synthesis-read.service';
import { ForumSynthesisResponseDto } from './forum-synthesis.dto';
import { ProposalMismatchReadService } from './proposal-mismatch-read.service';
import { assembleTallySummary, assembleTally, extractChoiceScores } from './proposal-tally';
import { ProposalTallyResponseDto } from './proposal-tally.dto';
import {
  ProposalAiSummaryResponseDto,
  ProposalDetailResponseDto,
  ProposalListResponseDto,
  type ProposalTallySummaryDto,
} from './proposal.dto';
import {
  toAiSummaryDto,
  toForumSynthesisResponse,
  toProposalDetailDto,
  toProposalListItemDto,
} from './proposal.mappers';
import { CROSS_DAO_PROPOSAL_QUERY, PER_DAO_PROPOSAL_QUERY } from './proposal.query';
import { SimilarProposalsReadService } from './similar-proposals-read.service';
import {
  SimilarProposalsMetaDto,
  SimilarProposalsResponseDto,
  SimilarQueryDto,
} from './similar-proposals.dto';
import { parseSimilarQuery } from './similar-proposals.query';
import { CacheControl } from '../cache/cache-control.decorator';
import { problemException } from '../http/problem-exception';
import { ApiEndpointQuery } from '../openapi/api-endpoint-query.decorator';
import { ProblemDto } from '../openapi/openapi.dto';
import { ApiListQueryDto } from '../openapi/query.dto';
import {
  assertCursorMatchesQuery,
  buildPagination,
  canonicalQuery,
  decodeCursor,
  parseLimit,
} from '../pagination/cursor';
import { applyQuery } from '../query/kysely-filter';
import { parseQuery } from '../query/query-parser';

@ApiTags('proposals')
@ApiBearerAuth()
@Controller('v1')
export class ProposalController {
  constructor(
    private readonly repo: ProposalReadRepository,
    private readonly daoRepo: DaoReadRepository,
    private readonly voteRepo: VoteReadRepository,
    @Inject(SOURCE_READ_EXTENSIONS)
    private readonly extensions: readonly SourceReadExtension[],
    // Optional cross-cutting enrichment: when unwired the summary field degrades to null (the same
    // graceful path as an unprocessed proposal). Always provided in production; the e2e guards it.
    @Optional() private readonly aiSummaries?: AiSummaryReadService,
    // Cross-DAO similarity search (SPEC §5.8); when unwired, /similar degrades to an empty list.
    @Optional() private readonly similar?: SimilarProposalsReadService,
    // Forum-thread synthesis (SPEC §5.7); when unwired, /ai/forum-synthesis 404s (as if unprocessed).
    @Optional() private readonly forumSynth?: ForumSynthesisReadService,
    // Embedded mismatch flag (SPEC §5.6); when unwired the field degrades to null (as if unprocessed).
    @Optional() private readonly mismatches?: ProposalMismatchReadService,
  ) {}

  /**
   * Per-choice tally summaries for a page of proposals, in two batched reads (CH aggregate + PG
   * choices) regardless of page size. Keyed by proposal id; a proposal with no votes maps to `null`.
   */
  private async tallySummariesFor(
    rows: readonly { id: string }[],
  ): Promise<Map<string, ProposalTallySummaryDto | null>> {
    const ids = rows.map((r) => r.id);
    const [aggregates, choices] = await Promise.all([
      this.voteRepo.tallyForProposals(ids),
      this.repo.findChoicesForProposals(ids),
    ]);

    const byProposal = new Map<string, ProposalTallySummaryDto | null>();
    for (const id of ids) {
      const summaryChoices = assembleTallySummary({
        declaredChoices: choices.get(id) ?? [],
        aggregate: aggregates.get(id) ?? [],
      });
      byProposal.set(id, summaryChoices === null ? null : { choices: summaryChoices });
    }
    return byProposal;
  }

  @ApiParam({ name: 'slug', type: String })
  @ApiOkResponse({ type: ProposalListResponseDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  @ApiEndpointQuery(PER_DAO_PROPOSAL_QUERY)
  @Get('daos/:slug/proposals')
  @CacheControl({ visibility: 'public', maxAgeSecs: 15, staleWhileRevalidateSecs: 300 })
  async listByDao(@Param('slug') slug: string, @Query() rawQuery: ApiListQueryDto) {
    const dao = await this.daoRepo.findDaoBySlug(slug);
    if (dao === undefined) {
      throw problemException('not-found', { detail: `No DAO found for slug=${slug}` });
    }

    const query = rawQuery as Record<string, unknown>;
    const parsed = parseQuery(query, PER_DAO_PROPOSAL_QUERY);
    const limit = parseLimit(query['limit']);
    const cursorRaw = typeof query['cursor'] === 'string' ? query['cursor'] : undefined;
    const cursor = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw);
    if (cursor !== undefined) {
      assertCursorMatchesQuery(cursor, parsed);
    }

    const canonical = canonicalQuery(parsed);
    const rows = await applyQuery(
      this.repo.listBaseQuery().where('dao.slug', '=', slug),
      parsed,
      PER_DAO_PROPOSAL_QUERY,
      limit,
      cursor,
    ).execute();

    const sort = parsed.sort[0] ?? PER_DAO_PROPOSAL_QUERY.defaultSort[0];
    const page = buildPagination(rows, limit, (row) => ({
      type: 'time',
      value: primarySortValue(row, sort?.field ?? 'created_at', sort?.dir ?? 'desc'),
      tiebreak: row.id,
      dir: sort?.dir ?? 'desc',
      q: canonical,
    }));

    const tallies = await this.tallySummariesFor(page.data);
    return {
      data: page.data.map((row) => toProposalListItemDto(row, tallies.get(row.id) ?? null)),
      pagination: page.pagination,
    };
  }

  @ApiParam({ name: 'slug', type: String })
  @ApiParam({ name: 'source_type', type: String })
  @ApiParam({ name: 'source_id', type: String })
  @ApiOkResponse({ type: ProposalDetailResponseDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  @Get('daos/:slug/proposals/:source_type/:source_id')
  @CacheControl({ visibility: 'private', maxAgeSecs: 0, mustRevalidate: true })
  async detail(
    @Param('slug') slug: string,
    @Param('source_type') sourceType: string,
    @Param('source_id') sourceId: string,
  ) {
    const row = await this.repo.findOne(slug, sourceType, sourceId);
    if (row === undefined) {
      throw problemException('not-found', {
        detail: `No proposal found for dao=${slug}, source_type=${sourceType}, source_id=${sourceId}`,
      });
    }

    const [actions, choices, originChainId, ext] = await Promise.all([
      this.repo.findActions(row.id),
      this.repo.findChoices(row.id),
      this.repo.resolveOriginChainId(row.id, sourceType),
      getProposalExtensionFor(this.extensions, row.id, sourceType),
    ]);
    // Both AI reads are cheap indexed ai_output lookups keyed off the same already-loaded
    // (description, actions); run them together so the detail latency is unaffected (SPEC §7.2).
    const [aiSummary, aiMismatch] = await Promise.all([
      this.aiSummaries?.findForProposal(row.description, actions) ?? null,
      this.mismatches?.findForProposal(row.description, actions) ?? null,
    ]);

    return {
      data: toProposalDetailDto(
        row,
        actions,
        choices,
        originChainId,
        ext.extension,
        ext.offchainDiscussionLinks,
        aiSummary,
        aiMismatch,
      ),
    };
  }

  @ApiParam({ name: 'slug', type: String })
  @ApiParam({ name: 'source_type', type: String })
  @ApiParam({ name: 'source_id', type: String })
  @ApiOkResponse({ type: ProposalAiSummaryResponseDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  @Get('daos/:slug/proposals/:source_type/:source_id/ai/summary')
  @CacheControl({ visibility: 'public', maxAgeSecs: 30, staleWhileRevalidateSecs: 300 })
  async aiSummary(
    @Param('slug') slug: string,
    @Param('source_type') sourceType: string,
    @Param('source_id') sourceId: string,
  ): Promise<ProposalAiSummaryResponseDto> {
    const row = await this.repo.findOne(slug, sourceType, sourceId);
    if (row === undefined) {
      throw problemException('not-found', {
        detail: `No proposal found for dao=${slug}, source_type=${sourceType}, source_id=${sourceId}`,
      });
    }

    const actions = await this.repo.findActions(row.id);
    const output = (await this.aiSummaries?.findForProposal(row.description, actions)) ?? null;
    if (output === null) {
      throw problemException('not-found', {
        detail: `No AI summary for dao=${slug}, source_type=${sourceType}, source_id=${sourceId}`,
      });
    }

    return { data: toAiSummaryDto(output) };
  }

  @ApiParam({ name: 'slug', type: String })
  @ApiParam({ name: 'source_type', type: String })
  @ApiParam({ name: 'source_id', type: String })
  @ApiOkResponse({ type: SimilarProposalsResponseDto })
  @ApiBadRequestResponse({ type: ProblemDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  @Get('daos/:slug/proposals/:source_type/:source_id/similar')
  @CacheControl({ visibility: 'public', maxAgeSecs: 30, staleWhileRevalidateSecs: 300 })
  async similarProposals(
    @Param('slug') slug: string,
    @Param('source_type') sourceType: string,
    @Param('source_id') sourceId: string,
    @Query() raw: SimilarQueryDto,
  ): Promise<SimilarProposalsResponseDto> {
    const row = await this.repo.findOne(slug, sourceType, sourceId);
    if (row === undefined) {
      throw problemException('not-found', {
        detail: `No proposal found for dao=${slug}, source_type=${sourceType}, source_id=${sourceId}`,
      });
    }

    // Graceful degrade (SPEC §5.8): an unembedded target / empty corpus yields `[]`, never a 404.
    const data = (await this.similar?.findSimilar(row.id, parseSimilarQuery(raw))) ?? [];
    return {
      data,
      _meta: Object.assign(new SimilarProposalsMetaDto(), {
        ai_generated: true,
        embedding_version: EMBEDDING_VERSION,
      }),
    };
  }

  @ApiParam({ name: 'slug', type: String })
  @ApiParam({ name: 'source_type', type: String })
  @ApiParam({ name: 'source_id', type: String })
  @ApiOkResponse({ type: ForumSynthesisResponseDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  @Get('daos/:slug/proposals/:source_type/:source_id/ai/forum-synthesis')
  @CacheControl({ visibility: 'public', maxAgeSecs: 30, staleWhileRevalidateSecs: 300 })
  async aiForumSynthesis(
    @Param('slug') slug: string,
    @Param('source_type') sourceType: string,
    @Param('source_id') sourceId: string,
  ): Promise<ForumSynthesisResponseDto> {
    const row = await this.repo.findOne(slug, sourceType, sourceId);
    if (row === undefined) {
      throw problemException('not-found', {
        detail: `No proposal found for dao=${slug}, source_type=${sourceType}, source_id=${sourceId}`,
      });
    }

    // Source-blind: the raw_content of the proposal's primary linked forum thread, via the extension
    // seam (apps/api may not import @sources/*). null → the proposal has no linked thread with content.
    const content = await getOffchainDiscussionContentFor(this.extensions, row.id);
    if (content === null) {
      throw problemException('not-found', {
        detail: `No forum thread linked to dao=${slug}, source_type=${sourceType}, source_id=${sourceId}`,
      });
    }

    // null → no synthesis yet (unprocessed / budget-capped). A non-English skip is a stored row and
    // is surfaced as 200 with `data: null` + `_meta.skipped_reason` by the mapper (SPEC §5.7).
    const output = (await this.forumSynth?.findForContent(content.raw_content)) ?? null;
    if (output === null) {
      throw problemException('not-found', {
        detail: `No forum synthesis for dao=${slug}, source_type=${sourceType}, source_id=${sourceId}`,
      });
    }

    return toForumSynthesisResponse(output);
  }

  @ApiParam({ name: 'slug', type: String })
  @ApiParam({ name: 'source_type', type: String })
  @ApiParam({ name: 'source_id', type: String })
  @ApiOkResponse({ type: ProposalTallyResponseDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiNotFoundResponse({ type: ProblemDto })
  @Get('daos/:slug/proposals/:source_type/:source_id/tally')
  @CacheControl({ visibility: 'public', maxAgeSecs: 10, staleWhileRevalidateSecs: 60 })
  async tally(
    @Param('slug') slug: string,
    @Param('source_type') sourceType: string,
    @Param('source_id') sourceId: string,
  ): Promise<ProposalTallyResponseDto> {
    const row = await this.repo.findOne(slug, sourceType, sourceId);
    if (row === undefined) {
      throw problemException('not-found', {
        detail: `No proposal found for dao=${slug}, source_type=${sourceType}, source_id=${sourceId}`,
      });
    }

    const [aggregate, choices, ext] = await Promise.all([
      this.voteRepo.tallyForProposal(row.id),
      this.repo.findChoices(row.id),
      getProposalExtensionFor(this.extensions, row.id, sourceType),
    ]);

    return {
      data: assembleTally({
        declaredChoices: choices.map((c) => c.choice_index),
        aggregate,
        choiceScores: extractChoiceScores(ext.extension?.metadata ?? null),
      }),
    };
  }

  @ApiOkResponse({ type: ProposalListResponseDto })
  @ApiUnauthorizedResponse({ type: ProblemDto })
  @ApiEndpointQuery(CROSS_DAO_PROPOSAL_QUERY)
  @Get('proposals')
  @CacheControl({ visibility: 'public', maxAgeSecs: 15, staleWhileRevalidateSecs: 300 })
  async listCrossDao(@Query() rawQuery: ApiListQueryDto) {
    const query = rawQuery as Record<string, unknown>;
    const parsed = parseQuery(query, CROSS_DAO_PROPOSAL_QUERY);
    const limit = parseLimit(query['limit']);
    const cursorRaw = typeof query['cursor'] === 'string' ? query['cursor'] : undefined;
    const cursor = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw);
    if (cursor !== undefined) {
      assertCursorMatchesQuery(cursor, parsed);
    }

    const canonical = canonicalQuery(parsed);
    const rows = await applyQuery(
      this.repo.listBaseQuery(),
      parsed,
      CROSS_DAO_PROPOSAL_QUERY,
      limit,
      cursor,
    ).execute();

    const sort = parsed.sort[0] ?? CROSS_DAO_PROPOSAL_QUERY.defaultSort[0];
    const page = buildPagination(rows, limit, (row) => ({
      type: 'time',
      value: primarySortValue(row, sort?.field ?? 'created_at', sort?.dir ?? 'desc'),
      tiebreak: row.id,
      dir: sort?.dir ?? 'desc',
      q: canonical,
    }));

    const tallies = await this.tallySummariesFor(page.data);
    return {
      data: page.data.map((row) => toProposalListItemDto(row, tallies.get(row.id) ?? null)),
      pagination: page.pagination,
    };
  }
}

function primarySortValue(
  row: {
    voting_starts_at: Date | null;
    voting_ends_at: Date | null;
    created_at: Date;
    state_updated_at: Date;
  },
  field: string,
  dir: 'asc' | 'desc',
): string {
  if (field === 'voting_starts_at') {
    return row.voting_starts_at === null
      ? dir === 'asc'
        ? 'infinity'
        : '-infinity'
      : new Date(row.voting_starts_at).toISOString();
  }

  if (field === 'voting_ends_at') {
    return row.voting_ends_at === null
      ? dir === 'asc'
        ? 'infinity'
        : '-infinity'
      : new Date(row.voting_ends_at).toISOString();
  }

  if (field === 'state_updated_at') {
    return new Date(row.state_updated_at).toISOString();
  }

  return new Date(row.created_at).toISOString();
}
