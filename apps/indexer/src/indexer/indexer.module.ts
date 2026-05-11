import { Module } from '@nestjs/common';
import { CompoundGovernorModule } from '@nest/sources-compound';

@Module({
  imports: [CompoundGovernorModule],
})
export class IndexerModule {}
