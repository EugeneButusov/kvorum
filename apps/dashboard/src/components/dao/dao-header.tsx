import { resolveTracks } from '@/lib/dao/tracks';
import { truncateAddress } from '@/lib/format';

/**
 * DAO header (§6.6 §1): name, description, governance tracks, primary token, and external links.
 *
 * The tracks line is the "governance summary (short prose)" of §6.6 §1 and takes over from the
 * standalone Governance tracks panel of §6.6 §6. §6.17's commitments survive the move: parallel
 * tracks are still surfaced explicitly, and no unified voting-power figure is introduced anywhere.
 * SPEC.md is frozen at v1.0, so the deviation is recorded here rather than there.
 *
 * Track blurbs ride on `title`, which is not keyboard-reachable. That is deliberate: the label
 * alone is meaningful, so the blurb is progressive enhancement rather than load-bearing content.
 */
export function DaoHeader({
  name,
  description,
  tokenAddress,
  websiteUrl,
  forumUrl,
  sourceTypes,
}: {
  name: string;
  description: string;
  tokenAddress: string;
  websiteUrl?: string;
  forumUrl?: string;
  sourceTypes: string[];
}) {
  const tracks = resolveTracks(sourceTypes);

  return (
    <header className="flex flex-col gap-3 border-b border-line-2 pb-6">
      <h1 className="text-h1 font-semibold text-ink">{name}</h1>
      {description && <p className="max-w-2xl text-body-lg text-ink-2">{description}</p>}
      {tracks.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-caption text-ink-3">
          <span id="dao-tracks-label" className="uppercase tracking-[0.04em] text-ink-4">
            Tracks
          </span>
          <ul
            aria-labelledby="dao-tracks-label"
            className="flex flex-wrap items-center gap-x-1.5 gap-y-1"
          >
            {tracks.map((track, index) => (
              <li key={track.sourceType} className="flex items-center gap-x-1.5">
                {index > 0 && (
                  <span aria-hidden="true" className="text-ink-4">
                    ·
                  </span>
                )}
                <span className="text-ink-2" title={track.description ?? undefined}>
                  {track.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-caption text-ink-3">
        {tokenAddress && (
          <dl className="flex items-center gap-2">
            <dt className="uppercase tracking-[0.04em] text-ink-4">Token</dt>
            <dd className="text-ink-2">{truncateAddress(tokenAddress)}</dd>
          </dl>
        )}
        {websiteUrl && (
          <a href={websiteUrl} className="text-ink-2 hover:text-ink" rel="noreferrer noopener">
            Website ↗
          </a>
        )}
        {forumUrl && (
          <a href={forumUrl} className="text-ink-2 hover:text-ink" rel="noreferrer noopener">
            Forum ↗
          </a>
        )}
      </div>
    </header>
  );
}
