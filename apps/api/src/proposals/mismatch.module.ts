import { Module } from '@nestjs/common';
import { AiOutputRepository } from '@libs/ai';
import { pgDb } from '@libs/db';
import { ProposalMismatchReadService } from './proposal-mismatch-read.service';

/**
 * Wires the proposal mismatch-flag read path (#448): the content-hash lookup against `ai_output`.
 * `AiOutputRepository` stays internal — only `ProposalMismatchReadService` is exported — so the
 * composition root deals with the service, not raw repositories. `pgDb` is the shared Kysely singleton.
 */
@Module({
  providers: [
    { provide: AiOutputRepository, useFactory: () => new AiOutputRepository(pgDb) },
    ProposalMismatchReadService,
  ],
  exports: [ProposalMismatchReadService],
})
export class MismatchModule {}
