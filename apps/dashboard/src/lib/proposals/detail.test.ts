import {
  classifyChoice,
  deriveTally,
  normalizeProposalDetail,
  normalizeVote,
  scaleReportedPower,
  type VoteView,
} from './detail';

const E18 = 1_000_000_000_000_000_000n; // 1 token, 18 decimals

function vote(power: bigint, choice: number | null, over: Partial<VoteView> = {}): VoteView {
  return {
    voteId: `v-${power}-${choice}`,
    votingChainId: '1',
    voter: { address: `0x${'0'.repeat(40)}`, displayName: null },
    votingPowerReported: power.toString(),
    votingPowerVerified: true,
    primaryChoice: choice,
    castAt: '2026-07-01T00:00:00Z',
    reason: null,
    ...over,
  };
}

const CHOICES = [
  { index: 0, value: 'For' },
  { index: 1, value: 'Against' },
  { index: 2, value: 'Abstain' },
];

describe('classifyChoice', () => {
  it.each([
    ['For', 'for'],
    ['Yes', 'for'],
    ['Approve', 'for'],
    ['Against', 'against'],
    ['No', 'against'],
    ['Reject', 'against'],
    ['Abstain', 'abstain'],
    ['Option C', 'abstain'],
  ] as const)('%s → %s', (value, kind) => {
    expect(classifyChoice(value)).toBe(kind);
  });
});

describe('deriveTally — from votes', () => {
  it('sums power by choice and derives percentages', () => {
    const votes = [vote(200n * E18, 0), vote(100n * E18, 0), vote(100n * E18, 1)];
    const tally = deriveTally({ choices: CHOICES, metadata: null }, votes);

    expect(tally.source).toBe('votes');
    expect(tally.voterCount).toBe(3);
    expect(tally.totalPower).toBe(400);

    const forSeg = tally.segments.find((s) => s.kind === 'for');
    const againstSeg = tally.segments.find((s) => s.kind === 'against');
    const abstainSeg = tally.segments.find((s) => s.kind === 'abstain');
    expect(forSeg?.pct).toBe(75);
    expect(againstSeg?.pct).toBe(25);
    expect(abstainSeg?.pct).toBe(0); // declared choice with no votes still surfaces
    expect(tally.leading?.kind).toBe('for');
  });

  it('keeps UInt256 precision beyond Number.MAX_SAFE_INTEGER', () => {
    // Two equal, huge powers → 50/50 with no float drift.
    const huge = 12_345_678_901_234_567_890_123_456_789n;
    const tally = deriveTally({ choices: CHOICES, metadata: null }, [vote(huge, 0), vote(huge, 1)]);
    expect(tally.segments.find((s) => s.kind === 'for')?.pct).toBe(50);
    expect(tally.segments.find((s) => s.kind === 'against')?.pct).toBe(50);
  });

  it('skips negative and non-integer power strings without poisoning the sum', () => {
    const votes = [
      vote(100n * E18, 0),
      { ...vote(0n, 1), votingPowerReported: '-5' },
      { ...vote(0n, 1), votingPowerReported: '1.5' },
    ];
    const tally = deriveTally({ choices: CHOICES, metadata: null }, votes);
    expect(tally.segments.find((s) => s.kind === 'for')?.pct).toBe(100);
    expect(tally.totalPower).toBe(100);
  });

  it('ignores votes with no primary choice', () => {
    const tally = deriveTally({ choices: CHOICES, metadata: null }, [
      vote(100n * E18, 0),
      vote(999n * E18, null),
    ]);
    expect(tally.totalPower).toBe(100);
  });

  it('propagates the partial flag', () => {
    const tally = deriveTally({ choices: CHOICES, metadata: null }, [vote(1n * E18, 0)], {
      partial: true,
    });
    expect(tally.partial).toBe(true);
  });
});

describe('deriveTally — from Snapshot choice_scores', () => {
  it('uses the pre-summed scores directly', () => {
    const metadata = {
      kind: 'snapshot' as const,
      space_id: 'lido-snapshot.eth',
      flagged: false,
      choice_scores: [100, 300],
    };
    const votes = [vote(1n, 0), vote(1n, 1), vote(1n, 1)];
    const tally = deriveTally(
      { choices: [CHOICES[0]!, CHOICES[1]!], metadata: metadata as never },
      votes,
    );

    expect(tally.source).toBe('choice_scores');
    expect(tally.totalPower).toBe(400);
    expect(tally.segments.find((s) => s.kind === 'for')?.pct).toBe(25);
    expect(tally.segments.find((s) => s.kind === 'against')?.pct).toBe(75);
    expect(tally.voterCount).toBe(3); // still the vote count
  });

  it('falls back to summing votes when choice_scores is absent', () => {
    const metadata = {
      kind: 'snapshot' as const,
      space_id: 's',
      flagged: false,
      choice_scores: null,
    };
    const tally = deriveTally({ choices: CHOICES, metadata: metadata as never }, [
      vote(2n * E18, 0),
    ]);
    expect(tally.source).toBe('votes');
  });
});

describe('scaleReportedPower', () => {
  it('scales 18-decimal base units to tokens', () => {
    expect(scaleReportedPower((42n * E18).toString())).toBe(42);
  });
  it('returns 0 for a non-integer string', () => {
    expect(scaleReportedPower('not-a-number')).toBe(0);
  });
});

describe('normalizers coerce the generator-mistyped nullable fields', () => {
  it('normalizeProposalDetail maps title / dates / proposer', () => {
    const raw = {
      dao_slug: 'lido',
      source_type: 'snapshot',
      source_id: '0xabc',
      title: 'Fund the treasury',
      state: 'active',
      binding: false,
      voting_starts_at: '2026-07-01T00:00:00Z',
      voting_ends_at: null,
      proposer: { address: '0xProposer', display_name: 'alice.eth' },
      _meta: { confirmed: true, last_updated_at: '2026-07-02T00:00:00Z', links: {} },
      description: 'body',
      actions: [],
      choices: [{ choice_index: 0, value: 'For' }],
      origin_chain_id: '1',
      voting: null,
      payloads: null,
      metadata: null,
      offchain_discussion_links: [],
    };
    const view = normalizeProposalDetail(raw as never);
    expect(view.title).toBe('Fund the treasury');
    expect(view.votingStartsAt).toBe('2026-07-01T00:00:00Z');
    expect(view.votingEndsAt).toBeNull();
    expect(view.proposer.displayName).toBe('alice.eth');
    expect(view.choices).toEqual([{ index: 0, value: 'For' }]);
  });

  it('normalizeVote coerces primary_choice / cast_at / reason', () => {
    const raw = {
      vote_id: 'v1',
      voting_chain_id: '1',
      voter: { address: '0xVoter', display_name: null, _meta: { links: { actor: '' } } },
      voting_power_reported: '1000',
      voting_power_verified: false,
      primary_choice: 2,
      cast_at: '2026-07-01T00:00:00Z',
      reason: 'because',
      _meta: { confirmed: true },
    };
    const view = normalizeVote(raw as never);
    expect(view.primaryChoice).toBe(2);
    expect(view.castAt).toBe('2026-07-01T00:00:00Z');
    expect(view.reason).toBe('because');
    expect(view.voter.displayName).toBeNull();
  });
});
