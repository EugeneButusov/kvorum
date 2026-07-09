import { PagePlaceholder } from '@/components/shell/page-placeholder';

export default async function DaoDelegatesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const name = slug.charAt(0).toUpperCase() + slug.slice(1);
  return <PagePlaceholder title={`${name} — delegates`} />;
}
