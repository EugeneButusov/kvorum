export type VoteProjectionHoldReason = 'no_proposal' | 'single_voting_chain_violation';
export type VoteProjectionDlqReason =
  | 'payload_missing'
  | 'decode_error'
  | 'projection_apply_error'
  | 'watermark_update_error'
  | 'block_timestamp_unavailable';
export type VoteProjectionErrorReason = VoteProjectionHoldReason | VoteProjectionDlqReason;

export class ProjectionError extends Error {
  constructor(public readonly reason: VoteProjectionErrorReason) {
    super(reason);
    this.name = 'ProjectionError';
  }
}
