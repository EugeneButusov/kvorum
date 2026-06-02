import { Module } from '@nestjs/common';
import { SOURCE_PLUGINS, type SourcePlugin } from '@sources/core';
import { AAVE_SOURCE_PLUGIN, AaveSourceModule } from '@nest/aave';
import { COMPOUND_SOURCE_PLUGIN, CompoundSourceModule } from '@nest/compound';

@Module({
  imports: [CompoundSourceModule, AaveSourceModule],
  providers: [
    {
      provide: SOURCE_PLUGINS,
      useFactory: (compound: SourcePlugin, aave: SourcePlugin): SourcePlugin[] => [compound, aave],
      inject: [COMPOUND_SOURCE_PLUGIN, AAVE_SOURCE_PLUGIN],
    },
  ],
  exports: [SOURCE_PLUGINS],
})
export class SourcesModule {}
