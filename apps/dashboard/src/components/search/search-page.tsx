'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { addRecentSearch, getRecentSearches } from './recent-searches';
import type { ActorItem, DaoItem, ProposalItem } from './search-result-item';
import { useSearch } from './use-search';
import type { components } from '@/lib/api/schema';
import { truncateAddress } from '@/lib/format';
import { cn } from '@/lib/utils';

type SearchData = components['schemas']['SearchDataDto'];
type EntityType = 'proposal' | 'dao' | 'actor';

const TABS: { key: EntityType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'proposal', label: 'Proposals' },
  { key: 'dao', label: 'DAOs' },
  { key: 'actor', label: 'Actors' },
];

type SearchPageProps = {
  initialData?: SearchData;
  initialQuery: string;
};

export function SearchPage({ initialData, initialQuery }: SearchPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlQuery = searchParams.get('q') ?? '';
  const urlType = (searchParams.get('type') as EntityType | null) ?? undefined;
  const activeType = urlType ?? 'all';

  const [inputValue, setInputValue] = useState(urlQuery || initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(urlQuery || initialQuery);

  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = inputValue.trim();
      setDebouncedQuery(trimmed);
      const params = new URLSearchParams();
      if (trimmed) params.set('q', trimmed);
      if (urlType) params.set('type', urlType);
      const qs = params.toString();
      router.replace(`/search${qs ? `?${qs}` : ''}`, { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue, urlType, router]);

  const searchOpts = useMemo(() => ({ type: urlType, limit: 25 as const }), [urlType]);
  const { data, isFetching } = useSearch(debouncedQuery, true, searchOpts);

  const results: SearchData | undefined =
    data?.data ?? (debouncedQuery === initialQuery ? initialData : undefined);

  const hasQuery = debouncedQuery.length > 0;
  const proposalCount = results?.proposals.length ?? 0;
  const daoCount = results?.daos.length ?? 0;
  const actorCount = results?.actors.length ?? 0;
  const totalCount = proposalCount + daoCount + actorCount;

  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  useEffect(() => {
    setRecentSearches(getRecentSearches());
  }, []);

  function handleTypeChange(type: EntityType | 'all') {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (type !== 'all') params.set('type', type);
    const qs = params.toString();
    router.replace(`/search${qs ? `?${qs}` : ''}`, { scroll: false });
  }

  function handleResultClick() {
    if (debouncedQuery) addRecentSearch(debouncedQuery);
  }

  function handleRecentClick(q: string) {
    setInputValue(q);
  }

  function tabCount(key: EntityType | 'all'): number {
    if (!results) return 0;
    switch (key) {
      case 'all':
        return totalCount;
      case 'proposal':
        return proposalCount;
      case 'dao':
        return daoCount;
      case 'actor':
        return actorCount;
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1.5 border-b border-line pb-5">
        <h1 className="font-mono text-h1 font-semibold tracking-[-0.01em] text-ink">Search</h1>
        <p className="max-w-[60ch] text-body-lg text-ink-2">
          Find proposals, DAOs, and actors across the Kvorum network.
        </p>
      </div>

      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden>
          ⌕
        </span>
        <input
          type="search"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Search proposals, DAOs, actors…"
          className="w-full border border-line-2 bg-bg py-2.5 pl-9 pr-3 font-mono text-body text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line focus-visible:outline-none"
          autoFocus
          spellCheck={false}
        />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-3" />
        )}
      </div>

      {hasQuery && (
        <div
          className="flex gap-1 border-b border-line-2"
          role="tablist"
          aria-label="Filter by type"
        >
          {TABS.map((tab) => {
            const count = tabCount(tab.key);
            const isActive = activeType === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => handleTypeChange(tab.key)}
                className={cn(
                  'flex items-center gap-1.5 border-b-2 px-3 py-2 text-small transition-colors',
                  isActive
                    ? 'border-accent text-ink'
                    : 'border-transparent text-ink-3 hover:text-ink-2',
                )}
              >
                {tab.label}
                {hasQuery && results && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-micro',
                      isActive ? 'bg-accent/10 text-accent' : 'bg-bg-3 text-ink-3',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col">
        {hasQuery && results && totalCount > 0 && (
          <>
            {(activeType === 'all' || activeType === 'proposal') && proposalCount > 0 && (
              <ResultSection label="Proposals">
                {results.proposals.map((p) => (
                  <ResultRow
                    key={`${p.source_type}-${p.source_id}`}
                    href={`/daos/${p.dao_slug}/proposals/${p.source_type}/${p.source_id}`}
                    onClick={handleResultClick}
                  >
                    <ProposalContent item={p} />
                  </ResultRow>
                ))}
              </ResultSection>
            )}
            {(activeType === 'all' || activeType === 'dao') && daoCount > 0 && (
              <ResultSection label="DAOs">
                {results.daos.map((d) => (
                  <ResultRow key={d.slug} href={`/daos/${d.slug}`} onClick={handleResultClick}>
                    <DaoContent item={d} />
                  </ResultRow>
                ))}
              </ResultSection>
            )}
            {(activeType === 'all' || activeType === 'actor') && actorCount > 0 && (
              <ResultSection label="Actors">
                {results.actors.map((a) => (
                  <ResultRow
                    key={a.primary_address}
                    href={`/actors/${a.primary_address}`}
                    onClick={handleResultClick}
                  >
                    <ActorContent item={a} />
                  </ResultRow>
                ))}
              </ResultSection>
            )}
          </>
        )}

        {hasQuery && !isFetching && totalCount === 0 && (
          <div className="py-12 text-center">
            <p className="text-body text-ink-2">No results for &ldquo;{debouncedQuery}&rdquo;</p>
            <ul className="mt-4 space-y-1 text-small text-ink-3">
              <li>Try different keywords</li>
              <li>Check your spelling</li>
              <li>Search by wallet address (0x...)</li>
            </ul>
          </div>
        )}

        {!hasQuery && recentSearches.length > 0 && (
          <div>
            <div className="pb-2 font-mono text-micro font-medium uppercase tracking-wider text-ink-3">
              Recent searches
            </div>
            <ul>
              {recentSearches.map((q) => (
                <li key={q}>
                  <button
                    onClick={() => handleRecentClick(q)}
                    className="w-full border-b border-line-3 px-3 py-2.5 text-left text-small text-ink-2 transition-colors hover:bg-bg-3 hover:text-ink"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!hasQuery && recentSearches.length === 0 && (
          <div className="py-12 text-center text-small text-ink-3">
            Start typing to search across proposals, DAOs, and actors.
          </div>
        )}
      </div>
    </>
  );
}

function ResultSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pb-4">
      <div className="pb-2 font-mono text-micro font-medium uppercase tracking-wider text-ink-3">
        {label}
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function ResultRow({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        onClick={onClick}
        className="flex items-center gap-3 border-b border-line-3 px-3 py-2.5 text-small text-ink-2 transition-colors hover:bg-bg-3 hover:text-ink"
      >
        {children}
      </Link>
    </li>
  );
}

function ProposalContent({ item }: { item: ProposalItem }) {
  const title = typeof item.title === 'string' ? item.title : null;
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-ink">{title ?? 'Untitled'}</div>
        <div className="truncate text-micro text-ink-3">
          {item.dao_name} &middot; {item.state}
        </div>
      </div>
      <span className="shrink-0 font-mono text-micro text-ink-3">#{item.source_id}</span>
    </>
  );
}

function DaoContent({ item }: { item: DaoItem }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate font-medium text-ink">{item.name}</div>
      <div className="truncate text-micro text-ink-3">{item.description}</div>
    </div>
  );
}

function ActorContent({ item }: { item: ActorItem }) {
  const displayName = typeof item.display_name === 'string' ? item.display_name : null;
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate font-medium text-ink">
        {displayName ?? truncateAddress(item.primary_address)}
      </div>
      {displayName && (
        <div className="truncate font-mono text-micro text-ink-3">
          {truncateAddress(item.primary_address)}
        </div>
      )}
    </div>
  );
}
