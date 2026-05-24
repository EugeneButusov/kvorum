import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  ChainContextRegistry,
  EnsClient,
  MainnetRequiredForEnsError,
  parseChainConfigFromEnv,
} from '@libs/chain';
import { ActorRepository, pgDb } from '@libs/db';
import { ChainContextModule } from '@nest/chain';
import { EnsResolverService } from './ens-resolver.service';

const MAINNET_CHAIN_ID = '0x1';

@Module({
  imports: [ScheduleModule.forRoot(), ChainContextModule],
  providers: [
    {
      provide: ActorRepository,
      useFactory: () => new ActorRepository(pgDb),
    },
    {
      provide: EnsClient,
      useFactory: async (registry: ChainContextRegistry): Promise<EnsClient> => {
        const chains = parseChainConfigFromEnv(process.env);
        const mainnet = chains.find((entry) => entry.chainId.toLowerCase() === MAINNET_CHAIN_ID);
        if (mainnet == null) {
          throw new MainnetRequiredForEnsError('missing-mainnet-chain-config');
        }

        const context = await registry.getOrCreate(mainnet);
        return new EnsClient(context.client);
      },
      inject: [ChainContextRegistry],
    },
    EnsResolverService,
  ],
  exports: [EnsResolverService],
})
export class EnsResolverModule {}
