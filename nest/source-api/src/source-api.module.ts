import { Module } from '@nestjs/common';
import type { SourceApiContribution } from '@libs/domain';
import { makeAaveApiContribution } from '@sources/aave/api';
import { compoundApiContribution } from '@sources/compound/api';
import { SOURCE_API_CONTRIBUTIONS, SourceApiRegistry } from './source-api.registry';

@Module({
  providers: [
    {
      provide: SOURCE_API_CONTRIBUTIONS,
      useFactory: (): SourceApiContribution[] => [
        compoundApiContribution,
        makeAaveApiContribution(),
      ],
    },
    SourceApiRegistry,
  ],
  exports: [SourceApiRegistry],
})
export class SourceApiModule {}
