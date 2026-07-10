import { Crumb } from '@/components/shell/crumb';
import { PagePlaceholder } from '@/components/shell/page-placeholder';

export default function DeveloperPage() {
  return (
    <>
      <Crumb items={[{ label: 'Home', href: '/' }, { label: 'Developer' }]} />
      <PagePlaceholder
        title="Developer"
        note="The developer dashboard lands with the auth milestone."
      />
    </>
  );
}
