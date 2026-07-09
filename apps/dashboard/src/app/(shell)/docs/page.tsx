import { Crumb } from '@/components/shell/crumb';
import { PagePlaceholder } from '@/components/shell/page-placeholder';

export default function DocsPage() {
  return (
    <>
      <Crumb items={[{ label: 'Home', href: '/' }, { label: 'API Docs' }]} />
      <PagePlaceholder title="API documentation" />
    </>
  );
}
