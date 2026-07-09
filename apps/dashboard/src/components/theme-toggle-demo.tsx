'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

/**
 * Interim bare theme toggle to prove light/dark wiring on the smoke page.
 * The real design-system ThemeToggle replaces it.
 */
export function ThemeToggleDemo() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="border border-line-2 bg-bg-2 px-3 py-1.5 font-mono text-small text-ink-2 hover:border-line hover:text-ink"
    >
      {mounted ? (isDark ? 'theme: dark' : 'theme: light') : 'theme: …'}
    </button>
  );
}
