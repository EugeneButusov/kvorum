import { AppFooter } from '@/components/shell/app-footer';
import { TopNav } from '@/components/shell/top-nav';

/**
 * Chrome wrapper for system pages that render OUTSIDE the (shell) route group — the root not-found,
 * the root error boundary, and the maintenance page. Routes inside (shell) already inherit the nav
 * from its layout, so those render <SystemPage> directly. §6.15: every error page keeps the primary
 * nav so users can navigate away to something that works.
 */
export function SystemShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <div className="flex flex-1 flex-col">{children}</div>
      <AppFooter />
    </div>
  );
}
