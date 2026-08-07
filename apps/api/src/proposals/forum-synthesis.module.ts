import { Module } from '@nestjs/common';
import { AiOutputRepository } from '@libs/ai';
import { pgDb } from '@libs/db';
import { ForumSynthesisReadService } from './forum-synthesis-read.service';

// Wires the content-addressed forum-synthesis reader for ProposalController's
// `…/ai/forum-synthesis` endpoint. `AiOutputRepository` stays internal (only the service is exported);
// `pgDb` is the shared Kysely singleton. Mirrors AiSummaryModule / SimilarProposalsModule.
@Module({
  providers: [
    { provide: AiOutputRepository, useFactory: () => new AiOutputRepository(pgDb) },
    ForumSynthesisReadService,
  ],
  exports: [ForumSynthesisReadService],
})
export class ForumSynthesisModule {}
