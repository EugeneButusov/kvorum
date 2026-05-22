export const CONFIRMATION_ARCHIVE_STAGE = 'confirmation_archive_stage';
export const VOTE_ARCHIVE_STAGE = 'vote_archive_stage';
export const DELEGATION_ARCHIVE_STAGE = 'delegation_archive_stage';
export const ACTOR_RESOLUTION_STAGE = 'actor_resolution_stage';

const RETRYABLE_STAGES = new Set([
  CONFIRMATION_ARCHIVE_STAGE,
  VOTE_ARCHIVE_STAGE,
  DELEGATION_ARCHIVE_STAGE,
  ACTOR_RESOLUTION_STAGE,
]);

export function isDlqRetryableStage(stage: string): boolean {
  return RETRYABLE_STAGES.has(stage);
}

export function isCompTokenArchiveStage(stage: string): boolean {
  return stage === DELEGATION_ARCHIVE_STAGE;
}
