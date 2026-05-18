import { Global, Module } from '@nestjs/common';
import { ChainContextRegistry } from './chain-context-registry';

@Global()
@Module({
  providers: [
    ChainContextRegistry,
    { provide: 'ChainContextRegistry', useExisting: ChainContextRegistry },
  ],
  exports: [ChainContextRegistry, 'ChainContextRegistry'],
})
export class ChainContextModule {}
