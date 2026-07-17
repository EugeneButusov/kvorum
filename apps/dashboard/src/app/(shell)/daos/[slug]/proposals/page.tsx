import { ProposalList } from '@/components/proposal/proposal-list';
import { serverApi } from '@/lib/api/client';
import { fetchProposalPage, paramsFromRecord, parseListParams } from '@/lib/proposals/list';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DaoProposalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const { filters, sort } = parseListParams(paramsFromRecord(await searchParams));
  const initialPage = await fetchProposalPage(serverApi(), { slug, filters, sort }).catch(() => ({
    items: [],
    nextCursor: null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h2 font-semibold text-ink">Proposals</h1>
      <ProposalList
        scope="dao"
        slug={slug}
        initialFilters={filters}
        initialSort={sort}
        initialPage={initialPage}
      />
    </div>
  );
}
