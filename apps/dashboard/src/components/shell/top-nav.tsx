'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { SearchBox } from './search-box';
import { WalletMenu } from './wallet-menu';
import { Logo } from '@/components/brand/Logo';
import { CommandPalette } from '@/components/search/command-palette';
import { ThemeToggle } from '@/components/theme-toggle';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { API_DOCS_URL } from '@/lib/site';
import { cn } from '@/lib/utils';

type NavItem = { label: string; href: string; external?: boolean };

// The reference is served by the API, not this app, so it leaves the SPA entirely — hence the
// `↗` already in the label and the `external` branch in both renderers below.
const NAV: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Proposals', href: '/proposals' },
  { label: 'DAOs', href: '/daos' },
  { label: 'Developer', href: '/developer' },
  { label: 'API Docs ↗', href: API_DOCS_URL, external: true },
];

function isActive(pathname: string, item: NavItem): boolean {
  // An off-site destination is never the current page. Stated rather than left to the fact that
  // a pathname cannot start with "https://", so the rule survives a relative external href.
  if (item.external === true) {
    return false;
  }
  return item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
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
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className="flex h-14 items-stretch border-b border-line bg-bg-2 px-4 md:px-8">
      <Link
        href="/"
        className="flex items-center gap-2.5 pr-4 md:border-r md:border-line-2 md:pr-7"
      >
        <Logo size={22} />
        <span className="font-mono text-body-lg font-bold tracking-[0.04em]">KVORUM</span>
      </Link>

      <nav className="hidden items-stretch md:flex">
        {NAV.map((item) =>
          item.external === true ? (
            <a
              key={item.href}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className={navClass(false)}
            >
              {item.label}
            </a>
          ) : (
            <Link key={item.href} href={item.href} className={navClass(isActive(pathname, item))}>
              {item.label}
            </Link>
          ),
        )}
      </nav>

      <div className="flex flex-1 items-center justify-end gap-2 md:gap-3 md:pl-4">
        <SearchBox className="hidden lg:flex" onClick={() => setPaletteOpen(true)} />
        <WalletMenu className="hidden md:inline-flex" />
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
            <SearchBox
              onClick={() => {
                setOpen(false);
                setPaletteOpen(true);
              }}
            />
            <nav className="flex flex-col">
              {NAV.map((item) => {
                const className = cn(
                  'border-b border-line-3 py-3 font-mono text-body-lg transition-colors',
                  isActive(pathname, item) ? 'text-ink' : 'text-ink-2 hover:text-ink',
                );
                // The drawer still closes behind an external entry — it opens a new tab, so
                // leaving it open would strand the reader on a menu when they come back.
                return item.external === true ? (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setOpen(false)}
                    className={className}
                  >
                    {item.label}
                  </a>
                ) : (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={className}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <WalletMenu />
          </SheetContent>
        </Sheet>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
}
