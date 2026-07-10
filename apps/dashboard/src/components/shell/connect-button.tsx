import { cn } from '@/lib/utils';

/**
 * Wallet slot. Present in the shell now; the SIWE connect flow lands in the auth
 * milestone, so this is an inert affordance until then.
 */
export function ConnectButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      title="Wallet sign-in — coming soon"
      className={cn(
        'bg-ink px-3.5 py-1.5 font-mono text-small font-semibold tracking-[0.02em] text-bg-2 transition hover:brightness-110',
        className,
      )}
    >
      Connect wallet
    </button>
  );
}
