import type { Metadata } from 'next';

import { ProposalList } from '@/components/proposal/proposal-list';
import { Crumb } from '@/components/shell/crumb';
import { PageContainer } from '@/components/shell/page-container';
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
    <>
      <Crumb items={[{ label: 'Home', href: '/' }, { label: 'Proposals' }]} />
      <PageContainer className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5 border-b border-line pb-5">
          <h1 className="font-mono text-h1 font-semibold tracking-[-0.01em] text-ink">Proposals</h1>
          <p className="max-w-[60ch] text-body-lg text-ink-2">
            Every proposal across tracked DAOs, normalized — filter by DAO, state, and type.
          </p>
        </div>
        <ProposalList
          scope="cross"
          initialFilters={filters}
          initialSort={sort}
          initialPage={initialPage}
          daoOptions={daoOptions}
        />
      </PageContainer>
    </>
  );
}
