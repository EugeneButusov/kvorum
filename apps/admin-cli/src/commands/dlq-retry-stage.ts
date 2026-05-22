export const CONFIRMATION_ARCHIVE_STAGE = 'confirmation_archive_stage';
export const VOTE_ARCHIVE_STAGE = 'vote_archive_stage';
export const DELEGATION_ARCHIVE_STAGE = 'delegation_archive_stage';

const STAGE_ALIAS: Readonly<Record<string, string>> = {
  archive_confirmation_write: CONFIRMATION_ARCHIVE_STAGE,
  vote_archive_write: VOTE_ARCHIVE_STAGE,
  delegation_archive_write: DELEGATION_ARCHIVE_STAGE,
  [CONFIRMATION_ARCHIVE_STAGE]: CONFIRMATION_ARCHIVE_STAGE,
  [VOTE_ARCHIVE_STAGE]: VOTE_ARCHIVE_STAGE,
  [DELEGATION_ARCHIVE_STAGE]: DELEGATION_ARCHIVE_STAGE,
};

const RETRYABLE_STAGES = new Set([
  CONFIRMATION_ARCHIVE_STAGE,
  VOTE_ARCHIVE_STAGE,
  DELEGATION_ARCHIVE_STAGE,
]);

export function normalizeDlqRetryStage(stage: string): string {
  return STAGE_ALIAS[stage] ?? stage;
}

export function isDlqRetryableStage(stage: string): boolean {
  return RETRYABLE_STAGES.has(normalizeDlqRetryStage(stage));
}

export function isCompTokenArchiveStage(stage: string): boolean {
  return normalizeDlqRetryStage(stage) === DELEGATION_ARCHIVE_STAGE;
}
