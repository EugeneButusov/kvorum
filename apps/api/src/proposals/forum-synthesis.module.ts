import { Module } from '@nestjs/common';
import { AiOutputRepository } from '@libs/ai';
import { pgDb } from '@libs/db';
import { ForumSynthesisReadService } from '@nest/forum';

// Wires the content-addressed forum-synthesis reader for ProposalController's
// `…/ai/forum-synthesis` endpoint. The reader itself lives in @nest/forum (shared with the
// thread-keyed synthesis route); apps/api provides it here so the proposal controller can inject it.
// `AiOutputRepository` stays internal; `pgDb` is the shared Kysely singleton.
@Module({
  providers: [
    { provide: AiOutputRepository, useFactory: () => new AiOutputRepository(pgDb) },
    ForumSynthesisReadService,
  ],
  exports: [ForumSynthesisReadService],
})
export class ForumSynthesisModule {}
