export const CONFIRMATION_ARCHIVE_STAGE = 'archive_event_stage';
export const VOTE_ARCHIVE_STAGE = 'vote_archive_stage';
export const DELEGATION_ARCHIVE_STAGE = 'delegation_archive_stage';
export const ACTOR_RESOLUTION_STAGE = 'actor_resolution_stage';
export const VOTE_PROJECTION_STAGE = 'vote_projection_stage';
export const DELEGATION_PROJECTION_STAGE = 'delegation_projection_stage';
export const SNAPSHOT_DELEGATION_PROJECTION_STAGE = 'snapshot_delegation_projection_stage';
export const AAVE_IPFS_TITLE_FETCH_STAGE = 'aave_ipfs_title_fetch';

// pg-boss queue stages (re-enqueue via PgBossReEnqueueAdapter)
export const ARCHIVE_LOG_STAGE = 'archive_log';
export const ARCHIVE_DECODE_STAGE = 'archive_decode';
export const ARCHIVE_UNMAPPED_STAGE = 'archive_unmapped';

export type DlqRetryStage =
  | typeof CONFIRMATION_ARCHIVE_STAGE
  | typeof VOTE_ARCHIVE_STAGE
  | typeof DELEGATION_ARCHIVE_STAGE
  | typeof ACTOR_RESOLUTION_STAGE
  | typeof VOTE_PROJECTION_STAGE
  | typeof DELEGATION_PROJECTION_STAGE
  | typeof SNAPSHOT_DELEGATION_PROJECTION_STAGE
  | typeof AAVE_IPFS_TITLE_FETCH_STAGE
  | typeof ARCHIVE_LOG_STAGE
  | typeof ARCHIVE_DECODE_STAGE
  | typeof ARCHIVE_UNMAPPED_STAGE;

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
    [SNAPSHOT_DELEGATION_PROJECTION_STAGE]: true,
    [AAVE_IPFS_TITLE_FETCH_STAGE]: true,
    [ARCHIVE_LOG_STAGE]: true,
    [ARCHIVE_DECODE_STAGE]: true,
    [ARCHIVE_UNMAPPED_STAGE]: true,
  };
}
