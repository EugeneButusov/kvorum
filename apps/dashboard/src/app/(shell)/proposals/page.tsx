import { Crumb } from '@/components/shell/crumb';
import { PagePlaceholder } from '@/components/shell/page-placeholder';

export default function ProposalsPage() {
  return (
    <>
      <Crumb items={[{ label: 'Home', href: '/' }, { label: 'Proposals' }]} />
      <PagePlaceholder title="All proposals" />
    </>
  );
}
