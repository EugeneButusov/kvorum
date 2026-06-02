import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Interface } from 'ethers';
import { describe, expect, it } from 'vitest';
import { AAVE_GOVERNANCE_V3_TOPICS } from '../src/governance-v3/abi/events';

function loadAbi() {
  const path = join(__dirname, 'fixtures', 'abis', 'aave-governance-v3.json');
  return JSON.parse(readFileSync(path, 'utf8')) as unknown[];
}

describe('aave governance v3 ABI topic parity fixture', () => {
  it('keeps all governance-v3 event topics aligned with the pinned ABI fixture', () => {
    const iface = new Interface(loadAbi());

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
});
