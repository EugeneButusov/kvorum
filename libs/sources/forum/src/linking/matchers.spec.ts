import { describe, expect, it } from 'vitest';
import {
  classifyLink,
  extractForumThreadRefs,
  normalizeTitle,
  proposalTitleKey,
  stripStageTag,
  threadTitleKey,
} from './matchers';

const LIDO = 'research.lido.fi';
const AAVE = 'governance.aave.com';

describe('extractForumThreadRefs', () => {
  it('extracts topic id from a full URL with slug and optional post number', () => {
    const text = `See https://${LIDO}/t/some-proposal-slug/12345 and https://${LIDO}/t/x/678/9`;
    expect(extractForumThreadRefs(text, [LIDO])).toEqual([
      { host: LIDO, topicId: '12345' },
      { host: LIDO, topicId: '678' },
    ]);
  });

  it('extracts from a slugless /t/{id} URL', () => {
    expect(extractForumThreadRefs(`x https://${LIDO}/t/999 y`, [LIDO])).toEqual([
      { host: LIDO, topicId: '999' },
    ]);
  });

  it('deduplicates repeated references', () => {
    const text = `https://${LIDO}/t/a/1 https://${LIDO}/t/b/1`;
    expect(extractForumThreadRefs(text, [LIDO])).toEqual([{ host: LIDO, topicId: '1' }]);
  });

  it('only matches the given hosts', () => {
    expect(extractForumThreadRefs(`https://evil.example/t/x/1`, [LIDO])).toEqual([]);
    expect(extractForumThreadRefs(`https://${AAVE}/t/x/5`, [LIDO])).toEqual([]);
  });

  it('returns nothing when there is no forum link', () => {
    expect(extractForumThreadRefs('no links here', [LIDO, AAVE])).toEqual([]);
  });
});

describe('normalizeTitle', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeTitle('  Add   ETH/USD  Feed! ')).toBe('add eth usd feed');
  });
  it('folds diacritics via NFKD', () => {
    expect(normalizeTitle('Café Réserve')).toBe('cafe reserve');
  });
});

describe('stripStageTag', () => {
  it('strips a recognised leading stage tag', () => {
    expect(stripStageTag('[ARFC] Onboard X')).toEqual({ tag: 'ARFC', stripped: 'Onboard X' });
    expect(stripStageTag('[TEMP CHECK] Do Y')).toEqual({ tag: 'TEMP CHECK', stripped: 'Do Y' });
  });
  it('strips a tag with a suffix like AIP-123', () => {
    expect(stripStageTag('[AIP-42] Something')).toEqual({ tag: 'AIP-42', stripped: 'Something' });
  });
  it('stops at a non-stage bracket', () => {
    expect(stripStageTag('[Random] Title')).toEqual({ tag: null, stripped: '[Random] Title' });
  });
  it('handles a title with no tag', () => {
    expect(stripStageTag('Plain Title')).toEqual({ tag: null, stripped: 'Plain Title' });
  });
});

describe('title keys', () => {
  it('proposalTitleKey de-tags and normalizes, no tag required', () => {
    expect(proposalTitleKey('[ARFC] Add X')).toBe('add x');
    expect(proposalTitleKey('Add X')).toBe('add x');
    expect(proposalTitleKey(null)).toBeNull();
  });
  it('threadTitleKey requires a stage tag', () => {
    expect(threadTitleKey('[ARFC] Add X')).toBe('add x');
    expect(threadTitleKey('Add X')).toBeNull(); // no tag → not medium-eligible
    expect(threadTitleKey(null)).toBeNull();
  });
});

describe('classifyLink', () => {
  const thread = { host: LIDO, topicId: '12345', title: '[ARFC] Raise staking limit' };

  it('returns high when the description links the thread URL', () => {
    const proposal = { title: 'Whatever', description: `ref https://${LIDO}/t/slug/12345 here` };
    expect(classifyLink(proposal, thread)).toEqual({
      confidence: 'high',
      linkMethod: 'description_url',
    });
  });

  it('returns medium on a stage-tagged title match when there is no URL', () => {
    const proposal = { title: 'Raise staking limit', description: 'no url' };
    expect(classifyLink(proposal, thread)).toEqual({
      confidence: 'medium',
      linkMethod: 'community_curated',
    });
  });

  it('prefers high over medium for the same pair', () => {
    const proposal = {
      title: 'Raise staking limit',
      description: `https://${LIDO}/t/slug/12345`,
    };
    expect(classifyLink(proposal, thread)?.confidence).toBe('high');
  });

  it('returns null when the thread has no stage tag and no URL matches', () => {
    const untagged = { host: LIDO, topicId: '12345', title: 'Raise staking limit' };
    expect(classifyLink({ title: 'Raise staking limit', description: 'x' }, untagged)).toBeNull();
  });

  it('returns null when titles differ', () => {
    expect(classifyLink({ title: 'Something else', description: 'x' }, thread)).toBeNull();
  });
});
