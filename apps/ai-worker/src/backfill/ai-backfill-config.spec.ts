import { afterEach, describe, expect, it } from 'vitest';
import { AiBackfillConfig } from './ai-backfill-config';

const KEYS = [
  'AI_BACKFILL_ENABLED',
  'AI_BACKFILL_SUMMARIZE_ENABLED',
  'AI_BACKFILL_MISMATCH_ENABLED',
  'AI_BACKFILL_FORUM_ENABLED',
  'AI_BACKFILL_EMBED_ENABLED',
  'AI_BACKFILL_DAOS',
  'AI_BACKFILL_PAGE_SIZE',
];

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe('AiBackfillConfig', () => {
  const cfg = new AiBackfillConfig();

  it('is off by default (master + all features)', () => {
    expect(cfg.isEnabled()).toBe(false);
    expect(cfg.isFeatureEnabled('proposal_summarizer')).toBe(false);
  });

  it('a feature is enabled only when BOTH the master and per-feature flags are set', () => {
    process.env['AI_BACKFILL_SUMMARIZE_ENABLED'] = 'true';
    expect(cfg.isFeatureEnabled('proposal_summarizer')).toBe(false); // master still off
    process.env['AI_BACKFILL_ENABLED'] = 'true';
    expect(cfg.isFeatureEnabled('proposal_summarizer')).toBe(true);
    expect(cfg.isFeatureEnabled('mismatch_detector')).toBe(false); // its flag not set
  });

  it('parses the DAO slug list, trimming + dropping blanks', () => {
    process.env['AI_BACKFILL_DAOS'] = ' compound, aave ,lido, ';
    expect(cfg.daoSlugs()).toEqual(['compound', 'aave', 'lido']);
    delete process.env['AI_BACKFILL_DAOS'];
    expect(cfg.daoSlugs()).toEqual([]);
  });

  it('page size defaults to 100 and reads a positive override', () => {
    expect(cfg.pageSize()).toBe(100);
    process.env['AI_BACKFILL_PAGE_SIZE'] = '250';
    expect(cfg.pageSize()).toBe(250);
  });
});
