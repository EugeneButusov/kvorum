import type { KeyStatus } from '@/lib/developer/keys';
import { cn } from '@/lib/utils';

const STYLE: Record<KeyStatus, { label: string; className: string }> = {
  active: { label: 'Active', className: 'border-ok text-ok-ink bg-ok-bg' },
  // Rotated keys stay valid through a 24h grace window (SPEC §4.3) before they lapse.
  expiring: { label: 'Rotating', className: 'border-note text-note-ink bg-note-bg' },
  revoked: { label: 'Revoked', className: 'border-line-2 text-ink-4 bg-bg' },
};

export function KeyStatusBadge({ status }: { status: KeyStatus }) {
  const { label, className } = STYLE[status];
  return (
    <span
      className={cn(
        'inline-flex items-center border px-1.5 py-0.5 font-mono text-caption uppercase tracking-[0.04em]',
        className,
      )}
    >
      {label}
    </span>
  );
}
