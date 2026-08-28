'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { addRecentSearch, getRecentSearches } from './recent-searches';
import {
  SearchResultItem,
  type ProposalItem,
  type DaoItem,
  type ActorItem,
} from './search-result-item';
import { useSearch } from './use-search';
import { cn } from '@/lib/utils';

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FlatItem = {
  type: 'proposal' | 'dao' | 'actor';
  item: ProposalItem | DaoItem | ActorItem;
  url: string;
};

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setRecentSearches(getRecentSearches());
    }
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [debouncedQuery]);

  const { data, isFetching } = useSearch(debouncedQuery, open);

  const flatItems = useMemo<FlatItem[]>(() => {
    if (!data?.data) return [];
    const items: FlatItem[] = [];
    for (const p of data.data.proposals) {
      items.push({
        type: 'proposal',
        item: p,
        url: `/daos/${p.dao_slug}/proposals/${p.source_type}/${p.source_id}`,
      });
    }
    for (const d of data.data.daos) {
      items.push({ type: 'dao', item: d, url: `/daos/${d.slug}` });
    }
    for (const a of data.data.actors) {
      items.push({ type: 'actor', item: a, url: `/actors/${a.primary_address}` });
    }
    return items;
  }, [data]);

  const navigate = useCallback(
    (url: string) => {
      if (query.trim()) addRecentSearch(query.trim());
      onOpenChange(false);
      router.push(url);
    },
    [query, onOpenChange, router],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const total = debouncedQuery ? flatItems.length : recentSearches.length;
      if (total === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % total);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + total) % total);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (debouncedQuery && flatItems[selectedIndex]) {
          navigate(flatItems[selectedIndex].url);
        } else if (!debouncedQuery && recentSearches[selectedIndex]) {
          setQuery(recentSearches[selectedIndex]);
        }
      }
    },
    [debouncedQuery, flatItems, recentSearches, selectedIndex, navigate],
  );

  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery('');
      setDebouncedQuery('');
      setSelectedIndex(0);
    }
    onOpenChange(next);
  }

  const hasQuery = debouncedQuery.length > 0;
  const hasResults = flatItems.length > 0;
  const showRecent = !hasQuery && recentSearches.length > 0;

  const proposalCount = data?.data.proposals.length ?? 0;
  const daoCount = data?.data.daos.length ?? 0;

  const listboxId = 'command-palette-listbox';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-label="Search"
          className={cn(
            'fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2',
            'border border-line-2 bg-bg-2 shadow-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          <div className="flex items-center gap-2 border-b border-line-2 px-3">
            <span className="text-ink-3" aria-hidden>
              ⌕
            </span>
            <input
              role="combobox"
              aria-expanded={hasResults || showRecent}
              aria-controls={listboxId}
              aria-activedescendant={
                hasResults || showRecent ? `palette-item-${selectedIndex}` : undefined
              }
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search proposals, DAOs, actors…"
              className="flex-1 bg-transparent py-3 font-mono text-body text-ink outline-none placeholder:text-ink-3"
              spellCheck={false}
            />
            {isFetching && (
              <Loader2 className="size-4 animate-spin text-ink-3" aria-label="Loading" />
            )}
          </div>

          <div id={listboxId} role="listbox" className="max-h-[60vh] overflow-y-auto">
            {showRecent && (
              <>
                <div className="px-3 pb-1 pt-2 font-mono text-micro font-medium uppercase tracking-wider text-ink-3">
                  Recent searches
                </div>
                <ul>
                  {recentSearches.map((q, i) => (
                    <li
                      key={q}
                      id={`palette-item-${i}`}
                      role="option"
                      aria-selected={selectedIndex === i}
                      onClick={() => setQuery(q)}
                      className={cn(
                        'cursor-pointer px-3 py-2 text-small transition-colors',
                        selectedIndex === i
                          ? 'bg-bg-3 text-ink'
                          : 'text-ink-2 hover:bg-bg-3 hover:text-ink',
                      )}
                    >
                      {q}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {hasQuery && hasResults && (
              <>
                {proposalCount > 0 && (
                  <ResultGroup label="Proposals">
                    {data!.data.proposals.map((p, i) => (
                      <SearchResultItem
                        key={`${p.source_type}-${p.source_id}`}
                        id={`palette-item-${i}`}
                        type="proposal"
                        item={p}
                        selected={selectedIndex === i}
                        onSelect={() =>
                          navigate(`/daos/${p.dao_slug}/proposals/${p.source_type}/${p.source_id}`)
                        }
                      />
                    ))}
                  </ResultGroup>
                )}
                {daoCount > 0 && (
                  <ResultGroup label="DAOs">
                    {data!.data.daos.map((d, i) => (
                      <SearchResultItem
                        key={d.slug}
                        id={`palette-item-${proposalCount + i}`}
                        type="dao"
                        item={d}
                        selected={selectedIndex === proposalCount + i}
                        onSelect={() => navigate(`/daos/${d.slug}`)}
                      />
                    ))}
                  </ResultGroup>
                )}
                {data!.data.actors.length > 0 && (
                  <ResultGroup label="Actors">
                    {data!.data.actors.map((a, i) => (
                      <SearchResultItem
                        key={a.primary_address}
                        id={`palette-item-${proposalCount + daoCount + i}`}
                        type="actor"
                        item={a}
                        selected={selectedIndex === proposalCount + daoCount + i}
                        onSelect={() => navigate(`/actors/${a.primary_address}`)}
                      />
                    ))}
                  </ResultGroup>
                )}
              </>
            )}

            {hasQuery && hasResults && (
              <button
                onClick={() => navigate(`/search?q=${encodeURIComponent(debouncedQuery)}`)}
                className="w-full border-t border-line-2 px-3 py-2 text-center text-small text-accent transition-colors hover:bg-bg-3 hover:underline"
              >
                See all results &rarr;
              </button>
            )}

            {hasQuery && !isFetching && !hasResults && (
              <div className="px-3 py-8 text-center text-small text-ink-3">
                No results for &ldquo;{debouncedQuery}&rdquo;
              </div>
            )}

            {!hasQuery && !showRecent && (
              <div className="px-3 py-8 text-center text-small text-ink-3">
                Start typing to search…
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 border-t border-line-2 px-3 py-1.5 text-micro text-ink-3">
            <span>
              <kbd className="rounded border border-line-2 px-1">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="rounded border border-line-2 px-1">↵</kbd> open
            </span>
            <span>
              <kbd className="rounded border border-line-2 px-1">esc</kbd> close
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 pb-1 pt-2 font-mono text-micro font-medium uppercase tracking-wider text-ink-3">
        {label}
      </div>
      <ul>{children}</ul>
    </div>
  );
}
