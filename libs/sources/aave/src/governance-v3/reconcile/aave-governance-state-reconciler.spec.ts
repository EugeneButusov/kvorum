import { Interface } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import { AaveGovernanceStateReconciler } from './aave-governance-state-reconciler';
import {
  AaveGovernanceStateDecodeError,
  GOVERNANCE_STATE_INTERFACE,
} from '../abi/governance-state';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeProposalRepo() {
  return {
    fillEligibleVotingPower: vi.fn().mockResolvedValue(undefined),
  };
}

function makeProposals() {
  return {
    markReconcileChecked: vi.fn().mockResolvedValue(undefined),
    reconcileState: vi.fn().mockResolvedValue(1),
  };
}

function makeChainCtx(sendImpl?: (method: string, params: unknown[]) => unknown) {
  const stateSelector = GOVERNANCE_STATE_INTERFACE.getFunction('getProposalState')!.selector;
  const expirationSelector = GOVERNANCE_STATE_INTERFACE.getFunction(
    'PROPOSAL_EXPIRATION_TIME',
  )!.selector;
  return {
    client: {
      send: vi.fn(async (method: string, params: unknown[]) => {
        if (sendImpl) return sendImpl(method, params);
        if (method === 'eth_call') {
          const request = params[0] as { data: string };
          if (request.data.startsWith(stateSelector)) {
            return GOVERNANCE_STATE_INTERFACE.encodeFunctionResult('getProposalState', [7n]);
          }
          if (request.data.startsWith(expirationSelector)) {
            return GOVERNANCE_STATE_INTERFACE.encodeFunctionResult('PROPOSAL_EXPIRATION_TIME', [
              86400n,
            ]);
          }
        }
        return { timestamp: '0x64' };
      }),
    },
    chainCfg: { chainId: '0x1' },
  };
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'proposal-1',
    source_id: '42',
    source_type: 'aave_governance_v3',
    chain_id: '0x1',
    governance_address: '0x9aee0b04504cef83a65ac3f0e838d0593bcb2bc7',
    state: 'active',
    creation_block: '12',
    eligible_voting_power: null,
    voting_starts_block: null,
    primary_token_address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    ...overrides,
  };
}

describe('AaveGovernanceStateReconciler', () => {
  it('reconciles an expired row using creation block timestamp plus expiration time', async () => {
    const proposals = makeProposals();
    const reconciler = new AaveGovernanceStateReconciler(
      makeLogger() as never,
      ['aave_governance_v3'],
      makeProposalRepo() as never,
    );

    const result = await reconciler.reconcileRow({
      row: makeRow(),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: makeChainCtx() as never,
    });

    expect(proposals.markReconcileChecked).toHaveBeenCalledWith('proposal-1', '1000');
    expect(proposals.reconcileState).toHaveBeenCalledWith({
      proposalId: 'proposal-1',
      expectedStates: ['pending', 'active', 'queued'],
      targetState: 'expired',
      stateUpdatedAt: new Date((100 + 86400) * 1000),
    });
    expect(result).toEqual({ outcome: 'corrected', fromState: 'active', toState: 'expired' });
  });

  it('returns already_consistent when onchain state matches local state', async () => {
    const proposals = makeProposals();
    const reconciler = new AaveGovernanceStateReconciler(
      makeLogger() as never,
      ['aave_governance_v3'],
      makeProposalRepo() as never,
    );

    const result = await reconciler.reconcileRow({
      row: makeRow({ state: 'expired' }),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: makeChainCtx() as never,
    });

    expect(result).toEqual({ outcome: 'already_consistent' });
    expect(proposals.reconcileState).not.toHaveBeenCalled();
  });

  it('returns missed_event and does not write for event-driven divergence', async () => {
    const logger = makeLogger();
    const proposals = makeProposals();
    const reconciler = new AaveGovernanceStateReconciler(logger as never, ['aave_governance_v3']);

    const result = await reconciler.reconcileRow({
      row: makeRow({ state: 'pending' }),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: makeChainCtx((method, params) => {
        if (method === 'eth_call') {
          const request = params[0] as { data: string };
          if (
            request.data.startsWith(
              GOVERNANCE_STATE_INTERFACE.getFunction('getProposalState')!.selector,
            )
          ) {
            return GOVERNANCE_STATE_INTERFACE.encodeFunctionResult('getProposalState', [2n]);
          }
          return GOVERNANCE_STATE_INTERFACE.encodeFunctionResult('PROPOSAL_EXPIRATION_TIME', [
            86400n,
          ]);
        }
        return { timestamp: '0x64' };
      }) as never,
    });

    expect(result).toEqual({ outcome: 'missed_event' });
    expect(logger.error).toHaveBeenCalledWith(
      'state_reconcile_missed_event',
      expect.objectContaining({ onchain_state: 'active' }),
    );
    expect(proposals.reconcileState).not.toHaveBeenCalled();
  });

  it('returns guard_skipped when reconcileState updates no rows', async () => {
    const proposals = makeProposals();
    proposals.reconcileState.mockResolvedValue(0);
    const reconciler = new AaveGovernanceStateReconciler(
      makeLogger() as never,
      ['aave_governance_v3'],
      makeProposalRepo() as never,
    );

    const result = await reconciler.reconcileRow({
      row: makeRow(),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: makeChainCtx() as never,
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('returns guard_skipped when expiration is outside accepted bounds', async () => {
    const proposals = makeProposals();
    const reconciler = new AaveGovernanceStateReconciler(
      makeLogger() as never,
      ['aave_governance_v3'],
      makeProposalRepo() as never,
    );

    const result = await reconciler.reconcileRow({
      row: makeRow(),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: makeChainCtx((method, params) => {
        if (method === 'eth_call') {
          const request = params[0] as { data: string };
          if (
            request.data.startsWith(
              GOVERNANCE_STATE_INTERFACE.getFunction('PROPOSAL_EXPIRATION_TIME')!.selector,
            )
          ) {
            return GOVERNANCE_STATE_INTERFACE.encodeFunctionResult('PROPOSAL_EXPIRATION_TIME', [
              1n,
            ]);
          }
          return GOVERNANCE_STATE_INTERFACE.encodeFunctionResult('getProposalState', [7n]);
        }
        return { timestamp: '0x64' };
      }) as never,
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
    expect(proposals.reconcileState).not.toHaveBeenCalled();
  });

  it('rethrows decode errors while resolving expiration', async () => {
    const proposals = makeProposals();
    const reconciler = new AaveGovernanceStateReconciler(
      makeLogger() as never,
      ['aave_governance_v3'],
      makeProposalRepo() as never,
    );

    await expect(
      reconciler.reconcileRow({
        row: makeRow(),
        proposals: proposals as never,
        confirmedThreshold: 1000n,
        confirmedThresholdTag: '0x3e8',
        chainCtx: makeChainCtx((method, params) => {
          if (method === 'eth_call') {
            const request = params[0] as { data: string };
            if (
              request.data.startsWith(
                GOVERNANCE_STATE_INTERFACE.getFunction('PROPOSAL_EXPIRATION_TIME')!.selector,
              )
            ) {
              throw new AaveGovernanceStateDecodeError('bad expiration payload');
            }
            return GOVERNANCE_STATE_INTERFACE.encodeFunctionResult('getProposalState', [7n]);
          }
          return { timestamp: '0x64' };
        }) as never,
      }),
    ).rejects.toThrow('bad expiration payload');
  });

  it('caches expiration time per chain and governance address', async () => {
    const proposals = makeProposals();
    const chainCtx = makeChainCtx();
    const reconciler = new AaveGovernanceStateReconciler(
      makeLogger() as never,
      ['aave_governance_v3'],
      makeProposalRepo() as never,
    );

    await reconciler.reconcileRow({
      row: makeRow(),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: chainCtx as never,
    });
    await reconciler.reconcileRow({
      row: makeRow({ id: 'proposal-2', source_id: '43' }),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: chainCtx as never,
    });

    const expirationCalls = chainCtx.client.send.mock.calls.filter(
      ([method, params]) =>
        method === 'eth_call' &&
        (params[0] as { data: string }).data.startsWith(
          GOVERNANCE_STATE_INTERFACE.getFunction('PROPOSAL_EXPIRATION_TIME')!.selector,
        ),
    );
    expect(expirationCalls).toHaveLength(1);
  });

  it('fills eligible VP via totalSupply when voting_starts_block is set and VP is null', async () => {
    const proposals = makeProposals();
    const proposalRepo = makeProposalRepo();
    const expectedVp = 16_000_000n * 10n ** 18n;
    const erc20Iface = new Interface(['function totalSupply() view returns (uint256)']);
    const totalSupplySelector = erc20Iface.getFunction('totalSupply')!.selector;

    const chainCtx = makeChainCtx((method, params) => {
      if (method === 'eth_call') {
        const request = params[0] as { data: string };
        if (request.data.startsWith(totalSupplySelector)) {
          return erc20Iface.encodeFunctionResult('totalSupply', [expectedVp]);
        }
        if (
          request.data.startsWith(
            GOVERNANCE_STATE_INTERFACE.getFunction('getProposalState')!.selector,
          )
        ) {
          return GOVERNANCE_STATE_INTERFACE.encodeFunctionResult('getProposalState', [7n]);
        }
        return GOVERNANCE_STATE_INTERFACE.encodeFunctionResult('PROPOSAL_EXPIRATION_TIME', [
          86400n,
        ]);
      }
      return { timestamp: '0x64' };
    });

    const reconciler = new AaveGovernanceStateReconciler(
      makeLogger() as never,
      ['aave_governance_v3'],
      proposalRepo as never,
    );

    await reconciler.reconcileRow({
      row: makeRow({ voting_starts_block: '18000000' }),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: chainCtx as never,
    });

    expect(proposalRepo.fillEligibleVotingPower).toHaveBeenCalledWith(
      'proposal-1',
      expectedVp.toString(),
    );
  });

  it('skips eligible VP fill when voting_starts_block is null', async () => {
    const proposals = makeProposals();
    const proposalRepo = makeProposalRepo();
    const reconciler = new AaveGovernanceStateReconciler(
      makeLogger() as never,
      ['aave_governance_v3'],
      proposalRepo as never,
    );

    await reconciler.reconcileRow({
      row: makeRow({ voting_starts_block: null }),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: makeChainCtx() as never,
    });

    expect(proposalRepo.fillEligibleVotingPower).not.toHaveBeenCalled();
  });

  it('skips eligible VP fill when eligible_voting_power is already set', async () => {
    const proposals = makeProposals();
    const proposalRepo = makeProposalRepo();
    const reconciler = new AaveGovernanceStateReconciler(
      makeLogger() as never,
      ['aave_governance_v3'],
      proposalRepo as never,
    );

    await reconciler.reconcileRow({
      row: makeRow({
        voting_starts_block: '18000000',
        eligible_voting_power: '16000000000000000000000000',
      }),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: makeChainCtx() as never,
    });

    expect(proposalRepo.fillEligibleVotingPower).not.toHaveBeenCalled();
  });
});
