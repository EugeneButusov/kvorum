'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { ConnectButton } from './connect-button';
import { SearchBox } from './search-box';
import { Logo } from '@/components/brand/Logo';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const NAV = [
  { label: 'Home', href: '/' },
  { label: 'Proposals', href: '/proposals' },
];
const DAOS = [
  { label: 'All DAOs', href: '/daos' },
  { label: 'Compound', href: '/daos/compound' },
  { label: 'Uniswap', href: '/daos/uniswap' },
  { label: 'Aave', href: '/daos/aave' },
  { label: 'Lido', href: '/daos/lido' },
];
const TAIL = [
  { label: 'Developer', href: '/developer' },
  { label: 'API Docs ↗', href: '/docs' },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

function navClass(active: boolean): string {
  return cn(
    '-mb-px flex items-center border-b-2 px-5 text-body font-medium transition-colors',
    active ? 'border-primary text-ink' : 'border-transparent text-ink-2 hover:text-ink',
  );
}

export function TopNav() {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const daosActive = isActive(pathname, '/daos');

  return (
    <header className="flex h-14 items-stretch border-b border-line bg-bg-2 px-4 md:px-8">
      <Link
        href="/"
        className="flex items-center gap-2.5 pr-4 md:mr-2 md:border-r md:border-line-2 md:pr-7"
      >
        <Logo size={22} />
        <span className="font-mono text-body-lg font-bold tracking-[0.04em]">KVORUM</span>
      </Link>

      <nav className="hidden items-stretch md:flex">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={navClass(isActive(pathname, item.href))}
          >
            {item.label}
          </Link>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger className={navClass(daosActive)}>DAOs ▾</DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {DAOS.map((d) => (
              <DropdownMenuItem key={d.href} asChild>
                <Link href={d.href}>{d.label}</Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {TAIL.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={navClass(isActive(pathname, item.href))}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-1 items-center justify-end gap-2 md:gap-3 md:pl-4">
        <SearchBox className="hidden lg:flex" />
        <ConnectButton className="hidden md:inline-flex" />
        <ThemeToggle />

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Open menu"
              className="grid size-8 place-items-center border border-line-2 text-ink-2 hover:border-line hover:text-ink md:hidden"
            >
              <Menu className="size-4" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="gap-6">
            <SheetHeader>
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <SearchBox />
            <nav className="flex flex-col">
              {[...NAV, ...DAOS.slice(1), ...TAIL].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'border-b border-line-3 py-3 font-mono text-body-lg transition-colors',
                    isActive(pathname, item.href) ? 'text-ink' : 'text-ink-2 hover:text-ink',
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <ConnectButton />
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
