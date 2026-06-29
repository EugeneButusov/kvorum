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
