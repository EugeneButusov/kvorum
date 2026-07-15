import type { Metadata } from 'next';

import { DeveloperDashboard } from '@/components/developer/developer-dashboard';
import { Crumb } from '@/components/shell/crumb';
import { PageContainer } from '@/components/shell/page-container';

export const metadata: Metadata = { title: 'Developer' };

export default function DeveloperPage() {
  return (
    <>
      <Crumb items={[{ label: 'Home', href: '/' }, { label: 'Developer' }]} />
      <PageContainer className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-h2 font-semibold text-ink">Developer</h1>
          <p className="text-body text-ink-3">Manage your API keys, usage, and account.</p>
        </div>
        <DeveloperDashboard />
      </PageContainer>
    </>
  );
}
