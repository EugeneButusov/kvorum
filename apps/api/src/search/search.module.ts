import { Module } from '@nestjs/common';
import { pgDb } from '@libs/db';
import { SearchReadRepository } from './search-read-repository';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  providers: [
    {
      provide: SearchReadRepository,
      useFactory: () => new SearchReadRepository(pgDb),
    },
    SearchService,
  ],
  controllers: [SearchController],
})
export class SearchModule {}
