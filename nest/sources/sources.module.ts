import { Module } from '@nestjs/common';
import { SOURCE_PLUGINS, type SourcePlugin } from '@sources/core';
import { COMPOUND_SOURCE_PLUGIN, CompoundSourceModule } from '@nest/compound';

@Module({
  imports: [CompoundSourceModule],
  providers: [
    {
      provide: SOURCE_PLUGINS,
      useFactory: (compound: SourcePlugin): SourcePlugin[] => [compound],
      inject: [COMPOUND_SOURCE_PLUGIN],
    },
  ],
  exports: [SOURCE_PLUGINS],
})
export class SourcesModule {}
