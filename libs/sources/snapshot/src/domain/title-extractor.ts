const MAX_TITLE_LENGTH = 200;

/** ADR-030 per-source title rule for Snapshot: the proposal carries a native `title`, so this is
 *  just normalize + length-cap (no IPFS fetch, unlike Aave). Returns null for an empty/missing title;
 *  the projector substitutes a placeholder. */
export function extractSnapshotTitle(title: string | null | undefined): string | null {
  if (title == null) return null;
  const stripped = title
    .trim()
    .replace(/^#+\s*/, '')
    .trim();
  if (stripped.length === 0) return null;
  if (stripped.length <= MAX_TITLE_LENGTH) return stripped;
  return `${stripped.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}
