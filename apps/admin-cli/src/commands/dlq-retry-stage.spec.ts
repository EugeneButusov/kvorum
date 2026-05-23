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

  it('accepts actor resolution stage', () => {
    expect(isDlqRetryableStage('actor_resolution_stage')).toBe(true);
  });

  it('accepts vote projection stage', () => {
    expect(isDlqRetryableStage('vote_projection_stage')).toBe(true);
  });

  it('rejects non-retryable stage', () => {
    expect(isDlqRetryableStage('archive_decode')).toBe(false);
  });
});
