import type { Metadata } from 'next';

import { ProposalList } from '@/components/proposal/proposal-list';
import { Crumb } from '@/components/shell/crumb';
import { serverApi } from '@/lib/api/client';
import { fetchProposalPage, paramsFromRecord, parseListParams } from '@/lib/proposals/list';

export const metadata: Metadata = {
  title: 'All proposals — Kvorum',
  description:
    'Every governance proposal Kvorum tracks, across all DAOs — filterable and sortable.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function loadDaoOptions(): Promise<{ slug: string; name: string }[]> {
  try {
    const { data, error } = await serverApi().GET('/v1/daos', {
      params: { query: { limit: 100 } },
    });
    if (error || !data) return [];
    return data.data.map((d) => ({ slug: d.slug, name: d.name }));
  } catch {
    return [];
  }
}

export default async function ProposalsPage({ searchParams }: { searchParams: SearchParams }) {
  const { filters, sort } = parseListParams(paramsFromRecord(await searchParams));
  const [initialPage, daoOptions] = await Promise.all([
    fetchProposalPage(serverApi(), { filters, sort }).catch(() => ({
      items: [],
      nextCursor: null,
    })),
    loadDaoOptions(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Crumb items={[{ label: 'Home', href: '/' }, { label: 'Proposals' }]} />
      <h1 className="text-h1 font-semibold text-ink">All proposals</h1>
      <ProposalList
        scope="cross"
        initialFilters={filters}
        initialSort={sort}
        initialPage={initialPage}
        daoOptions={daoOptions}
      />
    </div>
  );
}
