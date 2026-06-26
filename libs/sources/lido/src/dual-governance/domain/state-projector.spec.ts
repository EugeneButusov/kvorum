import { describe, expect, it } from 'vitest';
import { projectDualGovernanceStateChange, type StateChangeCoords } from './state-projector';
import type { DualGovernanceStateChangedPayload } from './types';

const COORDS: StateChangeCoords = {
  daoId: 'dao-1',
  blockNumber: '23095715',
  txHash: '0x' + 'cd'.repeat(32),
  logIndex: 3,
};

function stateChanged(
  to: string,
  enteredAt: number,
): { type: 'DualGovernanceStateChanged'; payload: DualGovernanceStateChangedPayload } {
  return {
    type: 'DualGovernanceStateChanged',
    payload: {
      from: 'Normal',
      to,
      context: {
        state: to,
        enteredAt,
        vetoSignallingActivatedAt: 0,
        signallingEscrow: '0x' + '11'.repeat(20),
        rageQuitRound: 0,
        vetoSignallingReactivationTime: 0,
        normalOrVetoCooldownExitedAt: 0,
        rageQuitEscrow: '0x' + '00'.repeat(20),
        configProvider: '0x' + '22'.repeat(20),
      },
    },
  };
}

describe('projectDualGovernanceStateChange', () => {
  it('maps the to-state on-chain→PG, sets transition_at from enteredAt, optional cols NULL', () => {
    const event = stateChanged('Normal', 1754648507);
    const row = projectDualGovernanceStateChange(event, COORDS);
    expect(row).toEqual({
      dao_id: 'dao-1',
      state: 'normal',
      transition_at: new Date(1754648507 * 1000),
      block_number: '23095715',
      tx_hash: '0x' + 'cd'.repeat(32),
      log_index: 3,
      rage_quit_eth_amount: null,
      veto_signaling_started_at: null,
      veto_signaling_deactivated_at: null,
      payload: event.payload,
    });
  });

  it('maps each operating state name to its PG enum value', () => {
    const cases: Array<[string, string]> = [
      ['VetoSignalling', 'veto_signaling'],
      ['VetoSignallingDeactivation', 'veto_signaling_deactivation'],
      ['VetoCooldown', 'veto_cooldown'],
      ['RageQuit', 'rage_quit'],
    ];
    for (const [onchain, pg] of cases) {
      expect(projectDualGovernanceStateChange(stateChanged(onchain, 1), COORDS).state).toBe(pg);
    }
  });

  it('throws on an unmappable to-state (NotInitialized never persists as a to-state)', () => {
    expect(() =>
      projectDualGovernanceStateChange(stateChanged('NotInitialized', 1), COORDS),
    ).toThrow(/unmappable/);
  });

  it('fills veto_signaling_started_at from context.vetoSignallingActivatedAt', () => {
    const event = stateChanged('VetoSignalling', 1754600000);
    event.payload.context.vetoSignallingActivatedAt = 1754600000;
    const row = projectDualGovernanceStateChange(event, COORDS);
    expect(row.veto_signaling_started_at).toEqual(new Date(1754600000 * 1000));
    // Not the deactivation sub-state → deactivated_at stays NULL.
    expect(row.veto_signaling_deactivated_at).toBeNull();
    // rage_quit_eth_amount stays deferred (KNOWN-025).
    expect(row.rage_quit_eth_amount).toBeNull();
  });

  it('fills veto_signaling_deactivated_at from enteredAt only on the deactivation sub-state', () => {
    const event = stateChanged('VetoSignallingDeactivation', 1754610000);
    event.payload.context.vetoSignallingActivatedAt = 1754600000;
    const row = projectDualGovernanceStateChange(event, COORDS);
    expect(row.veto_signaling_started_at).toEqual(new Date(1754600000 * 1000));
    expect(row.veto_signaling_deactivated_at).toEqual(new Date(1754610000 * 1000));
  });

  it('leaves veto timestamps NULL when no signalling is active (zeroes ⇒ NULL)', () => {
    const row = projectDualGovernanceStateChange(stateChanged('Normal', 1754648507), COORDS);
    expect(row.veto_signaling_started_at).toBeNull();
    expect(row.veto_signaling_deactivated_at).toBeNull();
  });
});
