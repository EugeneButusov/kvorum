import { Module } from '@nestjs/common';
import { CompoundGovernorModule } from '../sources/compound-governor/compound-governor.module';

@Module({
  imports: [CompoundGovernorModule],
})
export class IndexerModule {}
