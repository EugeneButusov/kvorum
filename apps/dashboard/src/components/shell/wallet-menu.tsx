'use client';

import Link from 'next/link';
import { useState } from 'react';

import { SiweDialog } from '@/components/auth/siwe-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLogout, useSession } from '@/lib/auth/use-session';
import { truncateAddress } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * TopNav wallet control (design-decisions #391). Disconnected → a "Connect wallet" button that
 * opens the SIWE Dialog; connected → the identity chip with a dropdown to the developer dashboard
 * and sign-out. Session state comes from the cookie, not wallet connection, so a page reload keeps
 * the user signed in even before the wallet re-injects.
 */
export function WalletMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { data: session, isLoading } = useSession();
  const logout = useLogout();

  if (session) {
    const address = session.address;
    const label = address ? truncateAddress(address) : 'Account';
    const initials = (address ?? 'AC').replace(/^0x/, '').slice(0, 2).toUpperCase();
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'inline-flex items-center gap-2 border border-line-2 px-2.5 py-1 font-mono text-small text-ink transition-colors hover:border-line',
            className,
          )}
        >
          <Avatar className="size-5">
            <AvatarFallback className="text-micro">{initials}</AvatarFallback>
          </Avatar>
          {label}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href="/developer">Developer</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => logout.mutate()}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={isLoading}
        className={cn(
          'bg-ink px-3.5 py-1.5 font-mono text-small font-semibold tracking-[0.02em] text-bg-2 transition hover:brightness-110 disabled:opacity-60',
          className,
        )}
      >
        Connect wallet
      </button>
      <SiweDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
