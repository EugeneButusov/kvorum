import { describe, expect, it } from 'vitest';
import {
  DUAL_GOVERNANCE_TOPICS,
  TIMELOCK_TOPICS,
  DUAL_GOVERNANCE_INTERFACE,
  TIMELOCK_INTERFACE,
} from './events.js';
import {
  DG_STATE_BY_ORDINAL,
  dgStateForOrdinal,
  DUAL_GOVERNANCE_GETTERS_INTERFACE,
} from './getters.js';

// These hex values are the topic0 hashes computed against live mainnet event logs during the AB0
// archaeology spike (2026-06-24, block 25387417). Locking the vendored signatures to them means any
// accidental change to an event's parameter types (which would silently break log decoding) fails CI.
// See ../VERIFICATION.md.
const VERIFIED_DG_TOPICS = {
  DualGovernanceStateChanged: '0x401dce14c21c941ca1145ce389c76a4a7d71cc53a8540017152baf3eb237f309',
  NewSignallingEscrowDeployed: '0xc0f1a18e08c85cf22fa704235a03f65fb5cbb6865d48842e4841dd524a2f4fa6',
  ProposerRegistered: '0x21049d33ee462b7341fa44cb6501c90d00147f57e0f9751fe7a296f775ec8aaa',
  ProposerExecutorSet: '0x93c024076e6c39162f773d92d0707b90c3b8e7958d72168e4a4d92b6699ae52a',
  ProposerUnregistered: '0x2067da2ab4af0fcc94aff6ebead2c7ff85757075b78babd7123a66bbd5c65d6c',
  // Added in AB1 (#328). ProposalSubmittedMeta cross-checked live against the DG-layer log signature;
  // the rest are keccak256 of the canonical signatures, locked here to catch parameter-type drift.
  ProposalSubmittedMeta: '0x232ce03ddb9384ef5aeb6333cad16b1c7e68e1977e0e6e5a3666e934569a15fc',
  EscrowMasterCopyDeployed: '0x03758110e5bb0bc8eb73e05382c02905b2bce34875905d1c156b2bad2b532951',
  ProposalsCancellerSet: '0x34655f7be96663a25362fc0d2c741c5da1ca3d44170970da4ad1734110dd426e',
  CancelAllPendingProposalsExecuted:
    '0x2298fa2d89588534f8cc810d1d330103cdc1dbc9a90d8ad69ecb945333811bb7',
  CancelAllPendingProposalsSkipped:
    '0xe37ee6060f57b78dc9b410581969e2db39a6dea9139ee0a1f4dc0ef2d9a2fed9',
} as const;

const VERIFIED_TIMELOCK_TOPICS = {
  ProposalSubmitted: '0x24ae498e7a5643162addf3812fe00ad3706e7c421edc41b033379affcbefc8ec',
  ProposalScheduled: '0x8b9c2cfee0d20895490bae51f33d88197032bb221b15e360155508136257569a',
  ProposalExecuted: '0x712ae1383f79ac853f8d882153778e0260ef8f03b504e2866e0593e04d2b291f',
  ProposalsCancelledTill: '0x3e1ea97f283ced0e88dc14cb33eca5f94bf01dc4e237248f7c30c52eb1f06935',
} as const;

describe('dual-governance vendored ABI', () => {
  it('matches the live-verified DualGovernance topic0 hashes', () => {
    for (const [name, hash] of Object.entries(VERIFIED_DG_TOPICS)) {
      expect(DUAL_GOVERNANCE_TOPICS[name as keyof typeof VERIFIED_DG_TOPICS]).toBe(hash);
    }
  });

  it('matches the live-verified Timelock topic0 hashes', () => {
    for (const [name, hash] of Object.entries(VERIFIED_TIMELOCK_TOPICS)) {
      expect(TIMELOCK_TOPICS[name as keyof typeof VERIFIED_TIMELOCK_TOPICS]).toBe(hash);
    }
  });

  it('exposes the getStateDetails fragment the reconciler depends on', () => {
    expect(DUAL_GOVERNANCE_GETTERS_INTERFACE.getFunction('getStateDetails')).not.toBeNull();
    // No getState() — the contract only offers persisted/effective getters.
    expect(DUAL_GOVERNANCE_GETTERS_INTERFACE.getFunction('getState')).toBeNull();
  });

  it('parses the DualGovernanceStateChanged Context tuple (9 fields)', () => {
    const ev = DUAL_GOVERNANCE_INTERFACE.getEvent('DualGovernanceStateChanged');
    expect(ev).not.toBeNull();
    // from, to, context-tuple
    expect(ev!.inputs).toHaveLength(3);
    expect(ev!.inputs[2]?.components).toHaveLength(9);
  });

  it('parses the ProposalSubmitted ExternalCall[] tuple', () => {
    const ev = TIMELOCK_INTERFACE.getEvent('ProposalSubmitted');
    // ExternalCall[] is a tuple-array: element components live under arrayChildren.
    expect(ev!.inputs[2]?.arrayChildren?.components).toHaveLength(3); // target, value, payload
  });

  it('maps State ordinals with NotInitialized at 0 (offset by 1 vs the PG enum)', () => {
    expect(DG_STATE_BY_ORDINAL[0]).toBe('NotInitialized');
    expect(dgStateForOrdinal(1)).toBe('Normal');
    expect(dgStateForOrdinal(5)).toBe('RageQuit');
    expect(() => dgStateForOrdinal(6)).toThrow();
  });
});
