import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Interface } from 'ethers';
import { describe, expect, it } from 'vitest';
import { AAVE_GOVERNANCE_V3_TOPICS } from '../src/governance-v3/abi/events';
import { AAVE_PAYLOADS_CONTROLLER_TOPICS } from '../src/payloads-controller/abi/events';
import { AAVE_VOTING_MACHINE_TOPICS } from '../src/voting-machine/abi/events';

function loadAbi(name: 'aave-governance-v3' | 'aave-payloads-controller' | 'aave-voting-machine') {
  const path = join(__dirname, 'fixtures', 'abis', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as unknown[];
}

describe('aave governance v3 ABI topic parity fixture', () => {
  it('keeps all governance-v3 event topics aligned with the pinned ABI fixture', () => {
    const iface = new Interface(loadAbi('aave-governance-v3'));

    expect(AAVE_GOVERNANCE_V3_TOPICS.ProposalCreated).toBe(
      iface.getEvent('ProposalCreated')!.topicHash.toLowerCase(),
    );
    expect(AAVE_GOVERNANCE_V3_TOPICS.VotingActivated).toBe(
      iface.getEvent('VotingActivated')!.topicHash.toLowerCase(),
    );
    expect(AAVE_GOVERNANCE_V3_TOPICS.ProposalQueued).toBe(
      iface.getEvent('ProposalQueued')!.topicHash.toLowerCase(),
    );
    expect(AAVE_GOVERNANCE_V3_TOPICS.ProposalExecuted).toBe(
      iface.getEvent('ProposalExecuted')!.topicHash.toLowerCase(),
    );
    expect(AAVE_GOVERNANCE_V3_TOPICS.ProposalCanceled).toBe(
      iface.getEvent('ProposalCanceled')!.topicHash.toLowerCase(),
    );
    expect(AAVE_GOVERNANCE_V3_TOPICS.ProposalFailed).toBe(
      iface.getEvent('ProposalFailed')!.topicHash.toLowerCase(),
    );
    expect(AAVE_GOVERNANCE_V3_TOPICS.PayloadSent).toBe(
      iface.getEvent('PayloadSent')!.topicHash.toLowerCase(),
    );
  });

  it('keeps all voting-machine event topics aligned with the pinned ABI fixture', () => {
    const iface = new Interface(loadAbi('aave-voting-machine'));

    expect(AAVE_VOTING_MACHINE_TOPICS.VoteEmitted).toBe(
      iface.getEvent('VoteEmitted')!.topicHash.toLowerCase(),
    );
    expect(AAVE_VOTING_MACHINE_TOPICS.ProposalVoteStarted).toBe(
      iface.getEvent('ProposalVoteStarted')!.topicHash.toLowerCase(),
    );
    expect(AAVE_VOTING_MACHINE_TOPICS.ProposalResultsSent).toBe(
      iface.getEvent('ProposalResultsSent')!.topicHash.toLowerCase(),
    );
    expect(AAVE_VOTING_MACHINE_TOPICS.ProposalVoteConfigurationBridged).toBe(
      iface.getEvent('ProposalVoteConfigurationBridged')!.topicHash.toLowerCase(),
    );
  });

  it('keeps all payloads-controller event topics aligned with the pinned ABI fixture', () => {
    const iface = new Interface(loadAbi('aave-payloads-controller'));

    expect(AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadCreated).toBe(
      iface.getEvent('PayloadCreated')!.topicHash.toLowerCase(),
    );
    expect(AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadQueued).toBe(
      iface.getEvent('PayloadQueued')!.topicHash.toLowerCase(),
    );
    expect(AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadExecuted).toBe(
      iface.getEvent('PayloadExecuted')!.topicHash.toLowerCase(),
    );
    expect(AAVE_PAYLOADS_CONTROLLER_TOPICS.PayloadCancelled).toBe(
      iface.getEvent('PayloadCancelled')!.topicHash.toLowerCase(),
    );
  });
});
