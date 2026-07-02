import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { pgDb } from '@libs/db';
import { ForumLinkRepository } from '@sources/forum';
import { ForumLinkerService } from './forum-linker.service';

// Indexer-only: the linker sweep must not run in the API. Kept out of SourcesModule (which the API
// also imports) for that reason.
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    { provide: ForumLinkRepository, useFactory: () => new ForumLinkRepository(pgDb) },
    ForumLinkerService,
  ],
})
export class ForumLinkerModule {}
