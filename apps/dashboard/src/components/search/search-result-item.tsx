'use client';

import { useCallback } from 'react';

import type { components } from '@/lib/api/schema';
import { truncateAddress } from '@/lib/format';
import { cn } from '@/lib/utils';

type ProposalItem = components['schemas']['ProposalSearchItemDto'];
type DaoItem = components['schemas']['DaoSearchItemDto'];
type ActorItem = components['schemas']['ActorSearchItemDto'];

export type { ProposalItem, DaoItem, ActorItem };

type SearchResultItemProps = {
  type: 'proposal' | 'dao' | 'actor';
  item: ProposalItem | DaoItem | ActorItem;
  selected: boolean;
  onSelect: () => void;
  id: string;
};

export function SearchResultItem({ type, item, selected, onSelect, id }: SearchResultItemProps) {
  const scrollRef = useCallback(
    (node: HTMLLIElement | null) => {
      if (node && selected) {
        node.scrollIntoView?.({ block: 'nearest' });
      }
    },
    [selected],
  );

  return (
    <li
      ref={scrollRef}
      id={id}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-3 px-3 py-2 text-small transition-colors',
        selected ? 'bg-bg-3 text-ink' : 'text-ink-2 hover:bg-bg-3 hover:text-ink',
      )}
    >
      {type === 'proposal' && <ProposalContent item={item as ProposalItem} />}
      {type === 'dao' && <DaoContent item={item as DaoItem} />}
      {type === 'actor' && <ActorContent item={item as ActorItem} />}
    </li>
  );
}

function ProposalContent({ item }: { item: ProposalItem }) {
  const title = typeof item.title === 'string' ? item.title : null;
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title ?? 'Untitled'}</div>
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
      <div className="truncate font-medium">{item.name}</div>
      <div className="truncate text-micro text-ink-3">{item.description}</div>
    </div>
  );
}

function ActorContent({ item }: { item: ActorItem }) {
  const displayName = typeof item.display_name === 'string' ? item.display_name : null;
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate font-medium">
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
