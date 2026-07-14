import type { ReactNode } from 'react';

import { AppFooter } from '@/components/shell/app-footer';
import { TopNav } from '@/components/shell/top-nav';
import { DegradedBar } from '@/components/system/degraded-bar';

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <DegradedBar />
      <div className="flex-1">{children}</div>
      <AppFooter />
    </div>
  );
}
