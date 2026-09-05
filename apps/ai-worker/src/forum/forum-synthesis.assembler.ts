import { Injectable } from '@nestjs/common';
import {
  FORUM_SYNTHESIZER_TEMPLATE,
  forumSkipMarker,
  render,
  type CompletionRequest,
  type CompletionResult,
  type CostContext,
  type ForumSynthesis,
  type RenderedPrompt,
} from '@libs/ai';
import type { ForumThreadForSynthesis } from '@sources/forum';

export interface AssembledForumInput {
  rendered: RenderedPrompt<ForumSynthesis>;
  ctx: CostContext;
  rawContent: string;
}

// Recorded as the `model` on the sentinel skip row — no model actually ran (the column is NOT NULL).
export const FORUM_SKIP_MODEL = 'none';

/**
 * Builds the (request, result) pair persisted for a non-English thread (SPEC §5.7 / KNOWN-016): a
 * zero-cost sentinel `ai_output` row keyed on the same `sha256(raw_content)`, whose output is the skip
 * marker the API reads back via `isForumSkip`. Shared by the sync handler and the batch driver so both
 * skip identically without an LLM call. `mode` is inert (nothing is submitted).
 */
export function buildForumSkip(
  rendered: RenderedPrompt<ForumSynthesis>,
  inputContent: string,
  inputHash: string,
  generatedAt: string,
): { req: CompletionRequest<ForumSynthesis>; result: CompletionResult<ForumSynthesis> } {
  const req: CompletionRequest<ForumSynthesis> = {
    feature: rendered.feature,
    promptVersion: rendered.promptVersion,
    model: FORUM_SKIP_MODEL,
    schema: rendered.schema,
    messages: rendered.messages,
    mode: 'sync',
    inputContent,
  };
  const result: CompletionResult<ForumSynthesis> = {
    // Not a valid ForumSynthesis — the skip marker occupies the same `output` column, hence the cast.
    output: forumSkipMarker('non_english') as unknown as ForumSynthesis,
    cost: {
      totalUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    provenance: {
      feature: rendered.feature,
      model: FORUM_SKIP_MODEL,
      promptVersion: rendered.promptVersion,
      inputHash,
      generatedAt,
    },
  };
  return { req, result };
}

/**
 * Builds the forum-synthesizer LLM input (SPEC §5.7): the thread's `raw_content` plus the linked
 * proposal title and DAO context. The cache key is `sha256(raw_content)` alone (the handler sets it
 * via `inputContent`), so the title/DAO — stable for a given thread — never perturb it. `raw_content`
 * is also returned so the handler can route the model on it (`chooseForumModel`).
 */
@Injectable()
export class ForumSynthesisAssembler {
  assemble(thread: ForumThreadForSynthesis): AssembledForumInput {
    const rawContent = thread.rawContent ?? '';
    const rendered = render(FORUM_SYNTHESIZER_TEMPLATE, {
      proposal_title: thread.linkedProposalTitle ?? thread.threadTitle ?? '',
      dao_name: thread.daoName,
      thread_content: rawContent,
    });
    return {
      rendered,
      ctx: { daoId: thread.daoId, entityReference: `forum_thread:${thread.id}` },
      rawContent,
    };
  }
}
