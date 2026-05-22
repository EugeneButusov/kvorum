const RETRYABLE_STAGES = new Set([
  'archive_confirmation_write',
  'vote_archive_write',
  'delegation_archive_write',
]);

export function isDlqRetryableStage(stage: string): boolean {
  return RETRYABLE_STAGES.has(stage);
}
