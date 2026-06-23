/**
 * Title extraction for Lido Aragon votes (ADR-030, `aragon_voting` row).
 *
 * Lido builds `StartVote.metadata` as PLAIN TEXT, never JSON — e.g.
 *   "Omnibus vote: <item1>;\n <item2>;\n …\n lidovoteipfs://<cid>"
 * (see lidofinance/scripts utils/voting.py). So the rule is: take the first
 * non-empty line that isn't the appended IPFS CID, strip a leading markdown `#`,
 * trim, cap at 200 chars. If nothing usable remains (empty metadata, or only a
 * bare CID), fall back to a deterministic placeholder `Lido Vote #{voteId}`.
 *
 * IPFS *resolution* (turning the CID into a richer title) is deferred; the
 * first-line / placeholder result is the contract here. ADR-030's note that Lido
 * uses `{title, description}` JSON is factually wrong → doc follow-up.
 */
const IPFS_CID_PREFIX = 'lidovoteipfs://';

function normalizeTitleLine(value: string): string | null {
  const stripped = value
    .trim()
    .replace(/^#+\s*/, '')
    .trim();
  if (stripped.length === 0) return null;
  if (stripped.startsWith(IPFS_CID_PREFIX)) return null;
  if (stripped.length <= 200) return stripped;
  return `${stripped.slice(0, 199)}…`;
}

export function extractAragonTitle(metadata: string, voteId: string): string {
  if (typeof metadata === 'string' && metadata.length > 0) {
    for (const rawLine of metadata.split('\n')) {
      const normalized = normalizeTitleLine(rawLine);
      if (normalized !== null) return normalized;
    }
  }
  return `Lido Vote #${voteId}`;
}
