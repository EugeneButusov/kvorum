import { Module } from '@nestjs/common';
import { AiOutputRepository } from '@libs/ai';
import { pgDb } from '@libs/db';
import { AiSummaryReadService } from './ai-summary-read.service';

/**
 * Wires the proposal AI-summary read path (#438): the content-hash lookup against `ai_output`.
 * `AiOutputRepository` stays internal — only `AiSummaryReadService` is exported — so the composition
 * root deals with the service, not raw repositories. `pgDb` is the shared Kysely singleton.
 */
@Module({
  providers: [
    { provide: AiOutputRepository, useFactory: () => new AiOutputRepository(pgDb) },
    AiSummaryReadService,
  ],
  exports: [AiSummaryReadService],
})
export class AiSummaryModule {}
