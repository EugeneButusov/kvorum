import { describe, expect, it } from 'vitest';
import { isDlqRetryableStage } from './dlq-retry-stage.js';

describe('isDlqRetryableStage', () => {
  it('accepts normalized confirmation stage', () => {
    expect(isDlqRetryableStage('confirmation_archive_stage')).toBe(true);
  });

  it('accepts normalized vote stage', () => {
    expect(isDlqRetryableStage('vote_archive_stage')).toBe(true);
  });

  it('accepts normalized delegation stage', () => {
    expect(isDlqRetryableStage('delegation_archive_stage')).toBe(true);
  });

  it('accepts legacy confirmation stage alias', () => {
    expect(isDlqRetryableStage('archive_confirmation_write')).toBe(true);
  });

  it('accepts legacy vote stage alias', () => {
    expect(isDlqRetryableStage('vote_archive_write')).toBe(true);
  });

  it('accepts legacy delegation stage alias', () => {
    expect(isDlqRetryableStage('delegation_archive_write')).toBe(true);
  });

  it('rejects non-retryable stage', () => {
    expect(isDlqRetryableStage('archive_decode')).toBe(false);
  });
});
