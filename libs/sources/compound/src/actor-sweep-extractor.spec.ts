import { describe, it, expect } from 'vitest';
import { COMPOUND_ACTOR_SWEEP_EXTRACTOR } from './actor-sweep-extractor';

const { eventTypes, extractAddresses } = COMPOUND_ACTOR_SWEEP_EXTRACTOR;

describe('COMPOUND_ACTOR_SWEEP_EXTRACTOR', () => {
  it('extracts the voter from VoteCast', () => {
    expect(extractAddresses('VoteCast', JSON.stringify({ voter: `0x${'a'.repeat(40)}` }))).toEqual([
      { address: `0x${'a'.repeat(40)}`, source: 'voter_event' },
    ]);
  });

  it.each(['ProposalCreated', 'ProposalQueued', 'ProposalExecuted', 'ProposalCanceled'] as const)(
    'returns [] for %s (must be resolvable, not thrown)',
    (eventType) => {
      expect(eventTypes).toContain(eventType);
      expect(extractAddresses(eventType, JSON.stringify({ proposalId: '1' }))).toEqual([]);
    },
  );

  it('still throws for a genuinely unsupported event type', () => {
    expect(() => extractAddresses('SomethingElse', '{}')).toThrow(/unsupported event_type/);
  });
});
