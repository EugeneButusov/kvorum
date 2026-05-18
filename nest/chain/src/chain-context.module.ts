import { Module } from '@nestjs/common';
import { ChainContextRegistry } from '@libs/chain';

@Module({
  providers: [{ provide: ChainContextRegistry, useFactory: () => new ChainContextRegistry() }],
  exports: [ChainContextRegistry],
})
export class ChainContextModule {}
