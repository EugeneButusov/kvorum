import { Module } from '@nestjs/common';
import {
  SOURCE_PLUGINS,
  SOURCE_SNAPSHOT_STRATEGIES,
  type SourcePlugin,
  type SourceSnapshotStrategies,
} from '@sources/core';
import {
  COMPOUND_SOURCE_PLUGIN,
  COMPOUND_SNAPSHOT_STRATEGIES,
  CompoundSourceModule,
} from '@nest/compound';

@Module({
  imports: [CompoundSourceModule],
  providers: [
    {
      provide: SOURCE_PLUGINS,
      useFactory: (compound: SourcePlugin): SourcePlugin[] => [compound],
      inject: [COMPOUND_SOURCE_PLUGIN],
    },
    {
      provide: SOURCE_SNAPSHOT_STRATEGIES,
      useFactory: (compound: SourceSnapshotStrategies): SourceSnapshotStrategies =>
        new Map(compound),
      inject: [COMPOUND_SNAPSHOT_STRATEGIES],
    },
  ],
  exports: [SOURCE_PLUGINS, SOURCE_SNAPSHOT_STRATEGIES],
})
export class SourcesModule {}
