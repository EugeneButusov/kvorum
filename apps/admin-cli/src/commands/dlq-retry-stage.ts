export const CONFIRMATION_ARCHIVE_STAGE = 'confirmation_archive_stage';
export const VOTE_ARCHIVE_STAGE = 'vote_archive_stage';
export const DELEGATION_ARCHIVE_STAGE = 'delegation_archive_stage';
export const ACTOR_RESOLUTION_STAGE = 'actor_resolution_stage';
export const VOTE_PROJECTION_STAGE = 'vote_projection_stage';
export const DELEGATION_PROJECTION_STAGE = 'delegation_projection_stage';
export const SNAPSHOT_COMPUTE_STAGE = 'snapshot_compute_stage';

export type DlqRetryStage =
  | typeof CONFIRMATION_ARCHIVE_STAGE
  | typeof VOTE_ARCHIVE_STAGE
  | typeof DELEGATION_ARCHIVE_STAGE
  | typeof ACTOR_RESOLUTION_STAGE
  | typeof VOTE_PROJECTION_STAGE
  | typeof DELEGATION_PROJECTION_STAGE
  | typeof SNAPSHOT_COMPUTE_STAGE;

export function isDlqRetryableStage(stage: string): boolean {
  return stage in getRetryableStageSet();
}

export function isCompTokenArchiveStage(stage: string): boolean {
  return stage === DELEGATION_ARCHIVE_STAGE;
}

function getRetryableStageSet(): Record<string, true> {
  return {
    [CONFIRMATION_ARCHIVE_STAGE]: true,
    [VOTE_ARCHIVE_STAGE]: true,
    [DELEGATION_ARCHIVE_STAGE]: true,
    [ACTOR_RESOLUTION_STAGE]: true,
    [VOTE_PROJECTION_STAGE]: true,
    [DELEGATION_PROJECTION_STAGE]: true,
    [SNAPSHOT_COMPUTE_STAGE]: true,
  };
}
