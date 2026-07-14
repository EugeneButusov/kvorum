import { NotFoundContent } from '@/components/system/not-found-content';
import { SystemShell } from '@/components/system/system-shell';

// Global 404 for truly unmatched URLs — served with a real HTTP 404. Renders outside the (shell)
// route group, so it brings its own nav via SystemShell. Segment-level not-found.tsx files handle
// the context-aware DAO / proposal / actor cases.
export default function NotFound() {
  return (
    <SystemShell>
      <NotFoundContent kind="generic" />
    </SystemShell>
  );
}
