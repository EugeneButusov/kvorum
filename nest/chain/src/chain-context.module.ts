import { Global, Module } from '@nestjs/common';
import { ChainContextRegistry } from '@libs/chain';

@Global()
@Module({
  providers: [
    {
      provide: ChainContextRegistry,
      useFactory: () => new ChainContextRegistry(),
    },
    { provide: 'ChainContextRegistry', useExisting: ChainContextRegistry },
  ],
  exports: [ChainContextRegistry, 'ChainContextRegistry'],
})
export class ChainContextModule {}
