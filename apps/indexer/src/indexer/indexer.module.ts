import { Module } from '@nestjs/common';
import { CompoundGovernorModule } from '@nest/compound';

@Module({
  imports: [CompoundGovernorModule],
})
export class IndexerModule {}
