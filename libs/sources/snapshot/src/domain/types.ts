// Raw Snapshot GraphQL rows. Only the fields the transport reads (`id`, `created`) are
// typed; the full row is archived verbatim as the off-chain payload, so the rest stays opaque.

export interface SnapshotProposalRow {
  id: string;
  /** Unix seconds; the forward cursor key and the derivation ordinal. */
  created: number;
}

export interface SnapshotVoteRow {
  id: string;
  /** Unix seconds; the forward cursor key and the derivation ordinal. */
  created: number;
}

// Forward-pagination state per entity. One `off_chain_cursor` row holds both — Snapshot's
// proposals and votes page independently within a single dao_source (one space).
export interface SnapshotSubCursor {
  /** `created_gte` lower bound (inclusive); rolls forward once a window is drained. */
  createdGte: number;
  /** Offset within the current `createdGte` window; reset to 0 on roll-forward. */
  skip: number;
}

export interface SnapshotCursor {
  proposals: SnapshotSubCursor;
  votes: SnapshotSubCursor;
}

// The archived raw Snapshot proposal slice (the GraphQL `proposals` row). Only the fields the
// proposal projector reads are typed; everything else in the payload is ignored. `deleted` is a
// reconcile-injected sentinel (a proposal that vanished from the API), not a Snapshot field.
export interface SnapshotProposalPayload {
  id: string;
  created: number;
  title?: string | null;
  body?: string | null;
  choices?: string[] | null;
  type?: string | null;
  start?: number | null;
  end?: number | null;
  state?: string | null;
  scores?: number[] | null;
  scores_total?: number | null;
  scores_state?: string | null;
  author?: string | null;
  ipfs?: string | null;
  network?: string | null;
  flagged?: boolean | null;
  strategies?: unknown;
  space?: { id?: string | null } | null;
  deleted?: boolean | null;
}
