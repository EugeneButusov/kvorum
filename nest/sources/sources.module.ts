import { Module } from '@nestjs/common';
import { SOURCE_PLUGINS, type SourcePlugin } from '@sources/core';
import { AAVE_SOURCE_PLUGIN, AaveSourceModule } from '@nest/aave';
import { COMPOUND_SOURCE_PLUGIN, CompoundSourceModule } from '@nest/compound';
import { LIDO_SOURCE_PLUGIN, LidoSourceModule } from '@nest/lido';

@Module({
  imports: [CompoundSourceModule, AaveSourceModule, LidoSourceModule],
  providers: [
    {
      provide: SOURCE_PLUGINS,
      useFactory: (
        compound: SourcePlugin,
        aave: SourcePlugin,
        lido: SourcePlugin,
      ): SourcePlugin[] => [compound, aave, lido],
      inject: [COMPOUND_SOURCE_PLUGIN, AAVE_SOURCE_PLUGIN, LIDO_SOURCE_PLUGIN],
    },
  ],
  exports: [SOURCE_PLUGINS],
})
export class SourcesModule {}
