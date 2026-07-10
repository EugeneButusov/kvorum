import type { ReactNode } from 'react';

import { AppFooter } from '@/components/shell/app-footer';
import { TopNav } from '@/components/shell/top-nav';

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <div className="flex-1">{children}</div>
      <AppFooter />
    </div>
  );
}
