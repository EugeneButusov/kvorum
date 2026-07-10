import { Crumb } from '@/components/shell/crumb';
import { PagePlaceholder } from '@/components/shell/page-placeholder';

export default function DaosPage() {
  return (
    <>
      <Crumb items={[{ label: 'Home', href: '/' }, { label: 'DAOs' }]} />
      <PagePlaceholder title="DAOs" note="The DAO directory lands in a later milestone." />
    </>
  );
}
