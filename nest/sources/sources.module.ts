import { Module } from '@nestjs/common';
import { SOURCE_PLUGINS, type SourcePlugin } from '@sources/core';
import { AAVE_SOURCE_PLUGIN, AaveSourceModule } from '@nest/aave';
import { COMPOUND_SOURCE_PLUGIN, CompoundSourceModule } from '@nest/compound';
import { FORUM_SOURCE_PLUGIN, ForumSourceModule } from '@nest/forum';
import { LIDO_SOURCE_PLUGIN, LidoSourceModule } from '@nest/lido';
import { SNAPSHOT_SOURCE_PLUGIN, SnapshotSourceModule } from '@nest/snapshot';

@Module({
  imports: [
    CompoundSourceModule,
    AaveSourceModule,
    LidoSourceModule,
    SnapshotSourceModule,
    ForumSourceModule,
  ],
  providers: [
    {
      provide: SOURCE_PLUGINS,
      useFactory: (
        compound: SourcePlugin,
        aave: SourcePlugin,
        lido: SourcePlugin,
        snapshot: SourcePlugin,
        forum: SourcePlugin,
      ): SourcePlugin[] => [compound, aave, lido, snapshot, forum],
      inject: [
        COMPOUND_SOURCE_PLUGIN,
        AAVE_SOURCE_PLUGIN,
        LIDO_SOURCE_PLUGIN,
        SNAPSHOT_SOURCE_PLUGIN,
        FORUM_SOURCE_PLUGIN,
      ],
    },
  ],
  // Re-export ForumSourceModule so its FORUM_LINK_READER provider is injectable by apps/api
  // controllers (which import SourcesModule), keeping the API source-blind.
  exports: [SOURCE_PLUGINS, ForumSourceModule],
})
export class SourcesModule {}
