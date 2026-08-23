import { Module } from '@nestjs/common';
import { AiOutputRepository } from '@libs/ai';
import { pgDb } from '@libs/db';
import { ForumThreadReadRepository } from '@sources/forum';
import { ForumSynthesisReadService } from './api/forum-synthesis-read.service';
import { ForumThreadController } from './api/forum-thread.controller';

/**
 * The forum read-API surface (§6.12), separate from the ingestion `ForumSourceModule` so the indexer
 * doesn't register an HTTP controller. apps/api imports this like any other read-feature module. Owns
 * the content-addressed forum-synthesis reader (§5.7) — the same reader apps/api's proposal route
 * reuses — so the thread-keyed synthesis route stays source-blind to apps/api.
 */
@Module({
  controllers: [ForumThreadController],
  providers: [
    { provide: ForumThreadReadRepository, useFactory: () => new ForumThreadReadRepository(pgDb) },
    { provide: AiOutputRepository, useFactory: () => new AiOutputRepository(pgDb) },
    ForumSynthesisReadService,
  ],
})
export class ForumApiModule {}
