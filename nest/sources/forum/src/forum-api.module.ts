import { Module } from '@nestjs/common';
import { pgDb } from '@libs/db';
import { ForumThreadReadRepository } from '@sources/forum';
import { ForumThreadController } from './api/forum-thread.controller';

/**
 * The forum read-API surface (§6.12), separate from the ingestion `ForumSourceModule` so the indexer
 * doesn't register an HTTP controller. apps/api imports this like any other read-feature module.
 */
@Module({
  controllers: [ForumThreadController],
  providers: [
    { provide: ForumThreadReadRepository, useFactory: () => new ForumThreadReadRepository(pgDb) },
  ],
})
export class ForumApiModule {}
