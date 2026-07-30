import { Injectable } from '@nestjs/common';
import {
  FORUM_SYNTHESIZER_TEMPLATE,
  render,
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
