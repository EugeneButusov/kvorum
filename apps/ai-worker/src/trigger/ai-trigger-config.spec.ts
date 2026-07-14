import { afterEach, describe, expect, it } from 'vitest';
import { AiTriggerConfig } from './ai-trigger-config';

describe('AiTriggerConfig', () => {
  const config = new AiTriggerConfig();
  afterEach(() => {
    delete process.env['AI_TRIGGER_SUMMARIZE_ENABLED'];
  });

  it('defaults off and reads env live', () => {
    expect(config.isEnabled('proposal_summarizer')).toBe(false);
    process.env['AI_TRIGGER_SUMMARIZE_ENABLED'] = 'true';
    expect(config.isEnabled('proposal_summarizer')).toBe(true);
    process.env['AI_TRIGGER_SUMMARIZE_ENABLED'] = '1'; // only 'true' enables
    expect(config.isEnabled('proposal_summarizer')).toBe(false);
  });
});
