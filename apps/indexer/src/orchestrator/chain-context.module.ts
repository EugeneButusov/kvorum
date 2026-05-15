import { Module } from '@nestjs/common';
import { ChainContextRegistry } from './chain-context-registry';

@Module({
  providers: [ChainContextRegistry],
  exports: [ChainContextRegistry],
})
export class ChainContextModule {}
