import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TopNav } from './top-nav';
// Relative, not `@/lib/site`: tsconfig.json excludes *.test.tsx, so vite-tsconfig-paths never
// applies the `@/` alias here. Existing tests only use it for type-only imports, which are
// erased before resolution — a value import through the alias fails to resolve.
import { API_DOCS_URL } from '../../lib/site';

vi.mock('next/navigation', () => ({
  usePathname: () => '/proposals',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}));

// The nav's siblings pull in TanStack Query and wagmi; stub them so this stays a test of the
// links themselves rather than of the whole shell's provider tree.
vi.mock('./search-box', () => ({ SearchBox: () => null }));
vi.mock('./wallet-menu', () => ({ WalletMenu: () => null }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));

describe('TopNav', () => {
  it('sends API Docs to the API-hosted reference in a new tab', () => {
    render(<TopNav />);

    const link = screen.getByRole('link', { name: /API Docs/ });
    expect(link).toHaveAttribute('href', API_DOCS_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('points at the API origin, not a route on this app', () => {
    // The regression this guards: the entry silently reverting to an in-app path, which is how it
    // shipped originally — the nav advertised docs and landed on a placeholder.
    expect(API_DOCS_URL).toMatch(/^https?:\/\//);
    expect(new URL(API_DOCS_URL).pathname).toBe('/v1/docs');
  });

  it('never marks the external entry as the current page', () => {
    render(<TopNav />);

    // `/proposals` is active, so the underline class is provably in play for internal entries.
    expect(screen.getByRole('link', { name: 'Proposals' }).className).toContain('border-primary');
    expect(screen.getByRole('link', { name: /API Docs/ }).className).not.toContain(
      'border-primary',
    );
  });

  it('keeps internal entries as in-app links', () => {
    render(<TopNav />);

    for (const [name, href] of [
      ['Proposals', '/proposals'],
      ['DAOs', '/daos'],
      ['Developer', '/developer'],
    ] as const) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('href', href);
      expect(link).not.toHaveAttribute('target');
    }
  });

  it('carries the same treatment into the mobile drawer', async () => {
    const user = userEvent.setup();
    render(<TopNav />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = await screen.findByRole('dialog');

    const link = within(drawer).getByRole('link', { name: /API Docs/ });
    expect(link).toHaveAttribute('href', API_DOCS_URL);
    expect(link).toHaveAttribute('target', '_blank');
  });
});
