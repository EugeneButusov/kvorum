import type { Metadata } from 'next';

import { SearchPage } from '@/components/search/search-page';
import { Crumb } from '@/components/shell/crumb';
import { PageContainer } from '@/components/shell/page-container';
import { serverApi } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';

type SearchData = components['schemas']['SearchDataDto'];

export const metadata: Metadata = {
  title: 'Search — Kvorum',
  robots: { index: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function entityType(v: string | undefined): 'proposal' | 'dao' | 'actor' | undefined {
  if (v === 'proposal' || v === 'dao' || v === 'actor') return v;
  return undefined;
}

export default async function SearchRoute({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = str(params.q)?.trim() ?? '';
  const type = entityType(str(params.type));

  let initialData: SearchData | undefined;
  if (q) {
    try {
      const { data } = await serverApi().GET('/v1/search', {
        params: { query: { q, type, limit: 25 } },
      });
      if (data) initialData = data.data;
    } catch {
      // API unavailable — client-side will retry
    }
  }

  return (
    <>
      <Crumb items={[{ label: 'Home', href: '/' }, { label: 'Search' }]} />
      <PageContainer className="flex flex-col gap-6">
        <SearchPage initialData={initialData} initialQuery={q} />
      </PageContainer>
    </>
  );
}
