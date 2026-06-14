import { describe, expect, it } from 'vitest';
import { isDlqRetryableStage } from './dlq-retry-stage.js';

describe('isDlqRetryableStage', () => {
  it('accepts normalized confirmation stage', () => {
    expect(isDlqRetryableStage('archive_event_stage')).toBe(true);
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

  it('accepts delegation projection stage', () => {
    expect(isDlqRetryableStage('delegation_projection_stage')).toBe(true);
  });

  it('accepts aave ipfs title fetch stage', () => {
    expect(isDlqRetryableStage('aave_ipfs_title_fetch')).toBe(true);
  });

  it('accepts archive_log stage', () => {
    expect(isDlqRetryableStage('archive_log')).toBe(true);
  });

  it('accepts archive_decode stage (pg-boss consumer path)', () => {
    expect(isDlqRetryableStage('archive_decode')).toBe(true);
  });

  it('accepts archive_unmapped stage', () => {
    expect(isDlqRetryableStage('archive_unmapped')).toBe(true);
  });

  it('rejects truly unknown stage', () => {
    expect(isDlqRetryableStage('nonexistent_stage')).toBe(false);
  });
});
