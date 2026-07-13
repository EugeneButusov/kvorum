import { truncateAddress } from '@/lib/format';

/** DAO header (§6.6 §1): name, description, primary token, and the external links. */
export function DaoHeader({
  name,
  description,
  tokenAddress,
  websiteUrl,
  forumUrl,
}: {
  name: string;
  description: string;
  tokenAddress: string;
  websiteUrl?: string;
  forumUrl?: string;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-line-2 pb-6">
      <h1 className="text-h1 font-semibold text-ink">{name}</h1>
      {description && <p className="max-w-2xl text-body-lg text-ink-2">{description}</p>}
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-caption text-ink-3">
        {tokenAddress && (
          <div className="flex items-center gap-2">
            <dt className="uppercase tracking-[0.04em] text-ink-4">Token</dt>
            <dd className="text-ink-2">{truncateAddress(tokenAddress)}</dd>
          </div>
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
      </dl>
    </header>
  );
}
