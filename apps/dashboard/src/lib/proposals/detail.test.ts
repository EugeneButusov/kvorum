import {
  classifyChoice,
  normalizeProposalDetail,
  normalizeVote,
  presentTallySummary,
  presentTally,
  scaleReportedPower,
  type TallyData,
} from './detail';

const E18 = 1_000_000_000_000_000_000n; // 1 token, 18 decimals

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

describe('presentTally — from votes', () => {
  const tally: TallyData = {
    source: 'votes',
    total_voting_power: (400n * E18).toString(),
    total_voters: 3,
    choices: [
      { choice_index: 0, voting_power: (300n * E18).toString(), voter_count: 2, pct: 75 },
      { choice_index: 1, voting_power: (100n * E18).toString(), voter_count: 1, pct: 25 },
    ],
  };

  it('labels, colour-classifies, and scales UInt256 power for display', () => {
    const out = presentTally(tally, CHOICES);
    expect(out.source).toBe('votes');
    expect(out.totalVoters).toBe(3);
    expect(out.totalPower).toBe(400); // scaled from base units
    expect(out.segments).toEqual([
      { choiceIndex: 0, label: 'For', kind: 'for', power: 300, pct: 75, voterCount: 2 },
      { choiceIndex: 1, label: 'Against', kind: 'against', power: 100, pct: 25, voterCount: 1 },
    ]);
    expect(out.leading?.label).toBe('For');
  });

  it('falls back to a synthetic label for an undeclared choice index', () => {
    const out = presentTally(
      { ...tally, choices: [{ choice_index: 7, voting_power: '0', voter_count: 0, pct: 0 }] },
      CHOICES,
    );
    expect(out.segments[0]!.label).toBe('Choice 8');
  });
});

describe('presentTally — from choice_scores', () => {
  it('uses the raw scores without base-unit scaling', () => {
    const tally: TallyData = {
      source: 'choice_scores',
      total_voting_power: '400',
      total_voters: 10,
      choices: [
        { choice_index: 0, voting_power: '100', voter_count: 4, pct: 25 },
        { choice_index: 1, voting_power: '300', voter_count: 6, pct: 75 },
      ],
    };
    const out = presentTally(tally, CHOICES);
    expect(out.source).toBe('choice_scores');
    expect(out.totalPower).toBe(400); // NOT divided by 1e18
    expect(out.segments.map((s) => s.power)).toEqual([100, 300]);
    expect(out.leading?.label).toBe('Against');
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

describe('presentTallySummary', () => {
  it('classifies choice labels into ordered For/Against/Abstain bars', () => {
    expect(
      presentTallySummary([
        { label: 'For', pct: 78 },
        { label: 'Against', pct: 19 },
        { label: 'Abstain', pct: 3 },
      ]),
    ).toEqual([
      { kind: 'for', pct: 78 },
      { kind: 'against', pct: 19 },
      { kind: 'abstain', pct: 3 },
    ]);
  });

  it('sums choices that classify into the same bucket', () => {
    // Two "yes"-family labels both fold into the For bar.
    expect(
      presentTallySummary([
        { label: 'Yes', pct: 40 },
        { label: 'Approve', pct: 20 },
        { label: 'No', pct: 40 },
      ]),
    ).toEqual([
      { kind: 'for', pct: 60 },
      { kind: 'against', pct: 40 },
    ]);
  });

  it('omits a bucket with no matching choice rather than drawing an empty bar', () => {
    expect(presentTallySummary([{ label: 'For', pct: 100 }])).toEqual([{ kind: 'for', pct: 100 }]);
  });

  it('is empty when there are no votes, so the row shows a dash', () => {
    expect(presentTallySummary(null)).toEqual([]);
    expect(presentTallySummary([])).toEqual([]);
  });
});
