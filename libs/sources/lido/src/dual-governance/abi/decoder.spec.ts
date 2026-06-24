import { describe, expect, it } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { decodeDualGovernanceLog } from './decoder';
import { DUAL_GOVERNANCE_INTERFACE, TIMELOCK_INTERFACE } from './events';

function makeLog(encoded: { topics: ReadonlyArray<string>; data: string }): LogEvent {
  return {
    sourceType: 'dual_governance',
    chainId: '0x1',
    blockNumber: 23095715n,
    blockHash: '0x' + 'ab'.repeat(32),
    txHash: '0x' + 'cd'.repeat(32),
    txIndex: 0,
    logIndex: 3,
    address: '0xC1db28B3301331277e307FDCfF8DE28242A4486E'.toLowerCase(),
    topics: encoded.topics as string[],
    data: encoded.data,
  };
}

function dgLog(name: string, values: unknown[]): LogEvent {
  const fragment = DUAL_GOVERNANCE_INTERFACE.getEvent(name)!;
  return makeLog(DUAL_GOVERNANCE_INTERFACE.encodeEventLog(fragment, values));
}
function tlLog(name: string, values: unknown[]): LogEvent {
  const fragment = TIMELOCK_INTERFACE.getEvent(name)!;
  return makeLog(TIMELOCK_INTERFACE.encodeEventLog(fragment, values));
}

const A1 = '0x1111111111111111111111111111111111111111';
const A2 = '0x2222222222222222222222222222222222222222';

describe('decodeDualGovernanceLog', () => {
  it('decodes the DualGovernanceStateChanged Context tuple, mapping State ordinals to names', () => {
    const context = [1, 1754648507, 0, A1, 0, 0, 0, '0x' + '00'.repeat(20), A2]; // Normal
    const decoded = decodeDualGovernanceLog(
      dgLog('DualGovernanceStateChanged', [0, 1, context]),
      'dual_governance',
    );
    expect(decoded).toEqual({
      type: 'DualGovernanceStateChanged',
      payload: {
        from: 'NotInitialized',
        to: 'Normal',
        context: {
          state: 'Normal',
          enteredAt: 1754648507,
          vetoSignallingActivatedAt: 0,
          signallingEscrow: A1,
          rageQuitRound: 0,
          vetoSignallingReactivationTime: 0,
          normalOrVetoCooldownExitedAt: 0,
          rageQuitEscrow: '0x' + '00'.repeat(20),
          configProvider: A2,
        },
      },
    });
  });

  it('decodes the DG-layer ProposalSubmitted (metadata) distinctly from the Timelock variant', () => {
    const decoded = decodeDualGovernanceLog(
      dgLog('ProposalSubmitted', [A1, 7n, 'Upgrade the staking router']),
      'dual_governance',
    );
    expect(decoded).toEqual({
      type: 'ProposalSubmittedMeta',
      payload: { proposerAccount: A1, proposalId: '7', metadata: 'Upgrade the staking router' },
    });
  });

  it('decodes the Timelock ProposalSubmitted with its ExternalCall[] calls', () => {
    const calls = [[A2, 0n, '0xdeadbeef']];
    const decoded = decodeDualGovernanceLog(
      tlLog('ProposalSubmitted', [7n, A1, calls]),
      'dual_governance',
    );
    expect(decoded).toEqual({
      type: 'ProposalSubmitted',
      payload: {
        id: '7',
        executor: A1,
        calls: [{ target: A2, value: '0', payload: '0xdeadbeef' }],
      },
    });
  });

  it('decodes bulk-cancel ProposalsCancelledTill as a single boundary id', () => {
    const decoded = decodeDualGovernanceLog(
      tlLog('ProposalsCancelledTill', [5n]),
      'dual_governance',
    );
    expect(decoded).toEqual({ type: 'ProposalsCancelledTill', payload: { proposalId: '5' } });
  });

  it('decodes ProposerRegistered + escrow + no-arg events', () => {
    expect(
      decodeDualGovernanceLog(dgLog('ProposerRegistered', [A1, A2]), 'dual_governance'),
    ).toEqual({
      type: 'ProposerRegistered',
      payload: { proposerAccount: A1, executor: A2 },
    });
    expect(
      decodeDualGovernanceLog(dgLog('NewSignallingEscrowDeployed', [A1]), 'dual_governance'),
    ).toEqual({ type: 'NewSignallingEscrowDeployed', payload: { escrow: A1 } });
    expect(
      decodeDualGovernanceLog(dgLog('CancelAllPendingProposalsExecuted', []), 'dual_governance'),
    ).toEqual({ type: 'CancelAllPendingProposalsExecuted', payload: {} });
  });

  it('decodes every remaining DG + Timelock event type to its discriminator', () => {
    const dgCases: Array<[string, unknown[], string]> = [
      ['EscrowMasterCopyDeployed', [A1], 'EscrowMasterCopyDeployed'],
      ['ConfigProviderSet', [A1], 'ConfigProviderSet'],
      ['ProposalsCancellerSet', [A1], 'ProposalsCancellerSet'],
      ['CancelAllPendingProposalsSkipped', [], 'CancelAllPendingProposalsSkipped'],
      ['ProposerExecutorSet', [A1, A2], 'ProposerExecutorSet'],
      ['ProposerUnregistered', [A1, A2], 'ProposerUnregistered'],
    ];
    for (const [event, args, expected] of dgCases) {
      expect(decodeDualGovernanceLog(dgLog(event, args), 'dual_governance').type).toBe(expected);
    }

    const tlCases: Array<[string, unknown[], string]> = [
      ['ProposalScheduled', [9n], 'ProposalScheduled'],
      ['ProposalExecuted', [9n], 'ProposalExecuted'],
      ['EmergencyModeActivated', [], 'EmergencyModeActivated'],
      ['EmergencyModeDeactivated', [], 'EmergencyModeDeactivated'],
    ];
    for (const [event, args, expected] of tlCases) {
      expect(decodeDualGovernanceLog(tlLog(event, args), 'dual_governance').type).toBe(expected);
    }
  });

  it('throws DecodeError on an unknown topic', () => {
    const log = makeLog({ topics: ['0x' + 'ff'.repeat(32)], data: '0x' });
    expect(() => decodeDualGovernanceLog(log, 'dual_governance')).toThrow(DecodeError);
  });
});
