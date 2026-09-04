import { createHash } from 'node:crypto';
import { AllProvidersFailedError, ClientStoppedError, type Logger } from '@libs/chain';
import type { NewDelegationFlowProjectionRow } from '@libs/db';
import type { ReconcileRpcClient } from '@sources/core';
import { projectSweepVotesChanged } from './delegation-projector';
import { AAVE_GOVERNANCE_POWER_TYPE } from '../abi/events';
import { encodeGetPowerCurrentCall, decodeGetPowerCurrentResult } from '../abi/get-power-current';

export interface DelegationPowerSweepDeps {
  discovery: { findKnownDelegateAddresses(daoId: string): Promise<string[]> };
  writer: { insertBatch(rows: readonly NewDelegationFlowProjectionRow[]): Promise<void> };
  daoIdResolver: { findDaoIdForSource(daoSourceId: string): Promise<string | undefined> };
  logger: Logger;
}

export interface DelegationPowerSweepConfig {
  tokenAddress: string;
  sweepCooldownBlocks: number;
  batchSize: number;
}

export interface DelegationPowerSweepHeadArgs {
  confirmedBlock: bigint;
  blockTag: string;
  client: ReconcileRpcClient;
  daoSourceId: string;
}

export class DelegationPowerSweepDriver {
  private inFlight = false;
  private lastSweepBlock = 0n;
  private resolvedDaoId: string | undefined;

  constructor(
    private readonly deps: DelegationPowerSweepDeps,
    private readonly config: DelegationPowerSweepConfig,
  ) {}

  async onConfirmedHead(args: DelegationPowerSweepHeadArgs): Promise<void> {
    if (this.inFlight) return;
    if (args.confirmedBlock - this.lastSweepBlock < BigInt(this.config.sweepCooldownBlocks)) return;

    this.inFlight = true;
    const tickStart = Date.now();

    try {
      const daoId = await this.resolveDaoId(args.daoSourceId);
      if (!daoId) {
        this.deps.logger.warn(
          'sweep: could not resolve daoId for daoSourceId=%s',
          args.daoSourceId,
        );
        return;
      }

      const delegates = await this.deps.discovery.findKnownDelegateAddresses(daoId);
      if (delegates.length === 0) {
        this.deps.logger.debug('sweep: no known delegates for daoId=%s', daoId);
        this.lastSweepBlock = args.confirmedBlock;
        return;
      }

      const rows = await this.sweepDelegates(delegates, daoId, args);

      if (rows.length > 0) {
        await this.deps.writer.insertBatch(rows);
      }

      this.lastSweepBlock = args.confirmedBlock;

      this.deps.logger.info(
        'sweep: wrote %d votes_changed rows at block %s (%dms)',
        rows.length,
        args.confirmedBlock.toString(),
        Date.now() - tickStart,
      );
    } finally {
      this.inFlight = false;
    }
  }

  private async sweepDelegates(
    delegates: string[],
    daoId: string,
    args: DelegationPowerSweepHeadArgs,
  ): Promise<NewDelegationFlowProjectionRow[]> {
    const rows: NewDelegationFlowProjectionRow[] = [];
    const now = new Date();
    let rpcFailed = 0;

    for (let i = 0; i < delegates.length; i += this.config.batchSize) {
      const batch = delegates.slice(i, i + this.config.batchSize);
      const results = await Promise.allSettled(
        batch.map((addr) => this.readPower(addr, args.client, args.blockTag)),
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j]!;
        const addr = batch[j]!;
        if (result.status === 'fulfilled') {
          rows.push(
            projectSweepVotesChanged(addr, result.value, {
              daoId,
              delegationId: deterministicId(addr, args.confirmedBlock.toString()),
              blockNumber: args.confirmedBlock.toString(),
              createdAt: now,
            }),
          );
        } else {
          rpcFailed++;
          this.deps.logger.warn('sweep: getPowerCurrent failed for %s: %s', addr, result.reason);
        }
      }
    }

    if (rpcFailed > 0) {
      this.deps.logger.warn('sweep: %d/%d RPC calls failed', rpcFailed, delegates.length);
    }

    return rows;
  }

  private async readPower(
    address: string,
    client: ReconcileRpcClient,
    blockTag: string,
  ): Promise<bigint> {
    try {
      const hex = await client.send<string>('eth_call', [
        {
          to: this.config.tokenAddress,
          data: encodeGetPowerCurrentCall(address, AAVE_GOVERNANCE_POWER_TYPE.VOTING),
        },
        blockTag,
      ]);
      return decodeGetPowerCurrentResult(hex);
    } catch (err) {
      if (err instanceof AllProvidersFailedError || err instanceof ClientStoppedError) throw err;
      throw err;
    }
  }

  private async resolveDaoId(daoSourceId: string): Promise<string | undefined> {
    if (this.resolvedDaoId) return this.resolvedDaoId;
    this.resolvedDaoId = await this.deps.daoIdResolver.findDaoIdForSource(daoSourceId);
    return this.resolvedDaoId;
  }
}

function deterministicId(address: string, blockNumber: string): string {
  const hash = createHash('sha256').update(`${address.toLowerCase()}:${blockNumber}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-');
}
