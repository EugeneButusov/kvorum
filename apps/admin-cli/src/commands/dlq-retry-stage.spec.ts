import { describe, expect, it } from 'vitest';
import { isDlqRetryableStage } from './dlq-retry-stage.js';

describe('isDlqRetryableStage', () => {
  it('accepts archive_confirmation_write', () => {
    expect(isDlqRetryableStage('archive_confirmation_write')).toBe(true);
  });

  it('accepts vote_archive_write', () => {
    expect(isDlqRetryableStage('vote_archive_write')).toBe(true);
  });

  it('accepts delegation_archive_write', () => {
    expect(isDlqRetryableStage('delegation_archive_write')).toBe(true);
  });

  it('rejects non-retryable stage', () => {
    expect(isDlqRetryableStage('archive_decode')).toBe(false);
  });
});
