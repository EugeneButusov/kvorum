import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourcePlugin } from '@sources/core';
import type { SourceIngester } from '@sources/core';
import { AAVE_SOURCE_PLUGIN, AaveSourceModule } from './aave.module';

vi.mock('@libs/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@libs/db')>();
  return {
    ...actual,
    pgDb: {},
    chDb: {},
    ArchiveEventRepository: class {
      public find = vi.fn();
      public insert = vi.fn();
      constructor(_db: unknown) {}
    },
    DlqRepository: class {
      public insert = vi.fn();
      constructor(_db: unknown) {}
    },
  };
});

describe('AaveSourceModule', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('compiles the testing module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AaveSourceModule],
    }).compile();

    expect(moduleRef).toBeDefined();
  });

  it('resolves AAVE_SOURCE_PLUGIN with the Aave derivers registered', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AaveSourceModule],
    }).compile();
    const plugin = moduleRef.get<SourcePlugin>(AAVE_SOURCE_PLUGIN);

    expect(plugin.name).toBe('aave');
    expect(plugin.ingesters).toHaveLength(8);
    expect(plugin.ingesters.map((ingester) => ingester.sourceType).sort()).toEqual([
      'aave_governance_v3',
      'aave_governance_v3_reconcile',
      'aave_governor_v2',
      'aave_governor_v2_reconcile',
      'aave_payloads_controller',
      'aave_payloads_controller_reconcile',
      'aave_token',
      'aave_voting_machine',
    ]);

    const aaveTokenIngester = plugin.ingesters.find(
      (ingester): ingester is SourceIngester<Record<string, unknown>> =>
        ingester.sourceType === 'aave_token',
    );
    expect(aaveTokenIngester).toBeDefined();
    expect(aaveTokenIngester?.supportedChainIds).toEqual(['0x1']);

    const votingMachineIngester = plugin.ingesters.find(
      (ingester): ingester is SourceIngester<Record<string, unknown>> =>
        ingester.sourceType === 'aave_voting_machine',
    );
    expect(votingMachineIngester).toBeDefined();
    expect(votingMachineIngester?.supportedChainIds).toEqual(['0x1', '0x89', '0xa86a']);

    const payloadsControllerIngester = plugin.ingesters.find(
      (ingester): ingester is SourceIngester<Record<string, unknown>> =>
        ingester.sourceType === 'aave_payloads_controller',
    );
    expect(payloadsControllerIngester).toBeDefined();
    expect(payloadsControllerIngester?.supportedChainIds).toEqual([
      '0x1',
      '0x89',
      '0xa86a',
      '0xa4b1',
      '0xa',
      '0x2105',
      '0x64',
      '0x38',
      '0x82750',
      '0xe708',
      '0xa4ec',
      '0x92',
      '0x440',
      '0x144',
    ]);

    expect(plugin.derivers).toHaveLength(11);
    expect(plugin.derivers.map((deriver) => deriver.kind).sort()).toEqual([
      'actor-address',
      'actor-address',
      'actor-address',
      'actor-address',
      'actor-address',
      'projection',
      'projection',
      'projection',
      'projection',
      'projection',
      'projection',
    ]);

    expect(plugin.apiContribution.sourceTypes).toContain('aave_governance_v3');
    expect(plugin.apiContribution.delegationModel('aave_governance_v3')).toBe('relationship-only');
    expect(
      plugin.derivers.some(
        (deriver) =>
          deriver.kind === 'projection' &&
          deriver.sourceTypes.includes('aave_voting_machine') &&
          deriver.eventTypes.includes('VoteEmitted') &&
          deriver.eventTypes.includes('ProposalVoteStarted'),
      ),
    ).toBe(true);
    expect(
      plugin.derivers.some(
        (deriver) =>
          deriver.kind === 'projection' &&
          deriver.sourceTypes.includes('aave_payloads_controller') &&
          deriver.eventTypes.includes('PayloadCreated') &&
          deriver.eventTypes.includes('PayloadExecuted'),
      ),
    ).toBe(true);
    expect(
      plugin.derivers.some(
        (deriver) =>
          deriver.kind === 'actor-address' &&
          deriver.sourceTypes.includes('aave_payloads_controller') &&
          deriver.eventTypes.includes('PayloadCreated') &&
          deriver.eventTypes.includes('PayloadCancelled'),
      ),
    ).toBe(true);
    expect(
      plugin.derivers.some(
        (deriver) =>
          deriver.kind === 'projection' &&
          deriver.sourceTypes.includes('aave_governor_v2') &&
          deriver.eventTypes.includes('ProposalCreated') &&
          deriver.eventTypes.includes('ProposalCanceled'),
      ),
    ).toBe(true);
    expect(
      plugin.derivers.some(
        (deriver) =>
          deriver.kind === 'projection' &&
          deriver.sourceTypes.includes('aave_governor_v2') &&
          deriver.eventTypes.includes('VoteEmitted'),
      ),
    ).toBe(true);
    expect(
      plugin.derivers.some(
        (deriver) =>
          deriver.kind === 'actor-address' &&
          deriver.sourceTypes.includes('aave_governor_v2') &&
          deriver.eventTypes.includes('ProposalCreated') &&
          deriver.eventTypes.includes('VoteEmitted'),
      ),
    ).toBe(true);
    expect(
      plugin.derivers.some(
        (deriver) =>
          deriver.kind === 'projection' &&
          deriver.sourceTypes.includes('aave_token') &&
          deriver.eventTypes.includes('DelegateChanged'),
      ),
    ).toBe(true);
    expect(
      plugin.derivers.some(
        (deriver) =>
          deriver.kind === 'actor-address' &&
          deriver.sourceTypes.includes('aave_token') &&
          deriver.eventTypes.includes('DelegateChanged'),
      ),
    ).toBe(true);
  });
});
