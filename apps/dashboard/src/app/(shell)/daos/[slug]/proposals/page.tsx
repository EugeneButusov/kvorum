import { ProposalList } from '@/components/proposal/proposal-list';
import { serverApi } from '@/lib/api/client';
import { fetchProposalPage, paramsFromRecord, parseListParams } from '@/lib/proposals/list';
import { sourceFilterOptions } from '@/lib/proposals/source';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function loadSourceTypes(slug: string): Promise<string[]> {
  try {
    const { data, error } = await serverApi().GET('/v1/daos/{slug}/sources', {
      params: { path: { slug } },
    });
    if (error || !data) return [];
    return sourceFilterOptions(data.data.map((s) => s.source_type));
  } catch {
    return [];
  }
}

export default async function DaoProposalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const { filters, sort } = parseListParams(paramsFromRecord(await searchParams));
  const [initialPage, sourceOptions] = await Promise.all([
    fetchProposalPage(serverApi(), { slug, filters, sort }).catch(() => ({
      items: [],
      nextCursor: null,
    })),
    loadSourceTypes(slug),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h2 font-semibold text-ink">Proposals</h1>
      <ProposalList
        scope="dao"
        slug={slug}
        initialFilters={filters}
        initialSort={sort}
        initialPage={initialPage}
        sourceOptions={sourceOptions}
      />
    </div>
  );
}
