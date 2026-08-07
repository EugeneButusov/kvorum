import { Module } from '@nestjs/common';
import { SimilarProposalsRepository } from '@libs/ai';
import { pgDb } from '@libs/db';
import { SimilarProposalsReadService } from './similar-proposals-read.service';

/**
 * Wires the proposal "similar proposals" read path (#447): the pgvector cosine-neighbour query.
 * `SimilarProposalsRepository` stays internal — only `SimilarProposalsReadService` is exported — so
 * the composition root deals with the service, mirroring `AiSummaryModule`.
 */
@Module({
  providers: [
    { provide: SimilarProposalsRepository, useFactory: () => new SimilarProposalsRepository(pgDb) },
    SimilarProposalsReadService,
  ],
  exports: [SimilarProposalsReadService],
})
export class SimilarProposalsModule {}
