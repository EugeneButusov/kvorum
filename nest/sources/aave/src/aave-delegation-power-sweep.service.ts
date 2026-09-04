import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ChainContextRegistry, parseChainConfigFromEnv } from '@libs/chain';
import {
  DaoSourceRepository,
  DelegateDiscoveryRepository,
  DelegationFlowProjectionWriter,
  chDb,
} from '@libs/db';
import { DelegationPowerSweepDriver, AAVE_TOKEN_ADDRESS } from '@sources/aave';
import { toChainLogger } from '@nest/chain';

@Injectable()
export class AaveDelegationPowerSweepService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('AaveDelegationPowerSweep');
  private unsub?: () => void;

  constructor(
    private readonly registry: ChainContextRegistry,
    private readonly daoSourceRepo: DaoSourceRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!process.env['CHAIN_CONFIG']) return;

    let chains;
    try {
      chains = parseChainConfigFromEnv(process.env);
    } catch {
      return;
    }

    const mainnet = chains.find((c) => c.chainId === '0x1');
    if (!mainnet) return;

    const sources = await this.daoSourceRepo.findAll();
    const aaveTokenSource = sources.find(
      (s) => s.source_type === 'aave_token' && s.chain_id === '0x1',
    );
    if (!aaveTokenSource) return;

    const chainCtx = await this.registry.getOrCreate(mainnet);

    const driver = new DelegationPowerSweepDriver(
      {
        discovery: new DelegateDiscoveryRepository(chDb),
        writer: new DelegationFlowProjectionWriter(chDb),
        daoIdResolver: this.daoSourceRepo,
        logger: toChainLogger(this.logger),
      },
      {
        tokenAddress: AAVE_TOKEN_ADDRESS,
        sweepCooldownBlocks: Number(process.env['AAVE_DELEGATION_SWEEP_COOLDOWN_BLOCKS'] ?? 450),
        batchSize: Number(process.env['AAVE_DELEGATION_SWEEP_BATCH_SIZE'] ?? 50),
      },
    );

    const daoSourceId = aaveTokenSource.id;
    this.unsub = chainCtx.headTracker.onHead(({ chainCfg, headBlock, client }) => {
      const headLag = BigInt(chainCfg.headLag);
      if (headBlock < headLag) return;
      const confirmedBlock = headBlock - headLag;
      void driver.onConfirmedHead({
        confirmedBlock,
        blockTag: `0x${confirmedBlock.toString(16)}`,
        client,
        daoSourceId,
      });
    });

    this.logger.log('delegation power sweep started');
  }

  async onApplicationShutdown(): Promise<void> {
    this.unsub?.();
  }
}
