/** @type {import('tailwindcss').Config} */
module.exports = {
  // Dark mode via the [data-theme="dark"] attribute the tokens key off (next-themes
  // sets it on <html>); NOT shadcn's .dark class. (ADR-077 §6)
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './{src,pages,components,app}/**/*.{ts,tsx,js,jsx,html}',
    '!./{src,pages,components,app}/**/*.{stories,spec}.{ts,tsx,js,jsx,html}',
  ],
  theme: {
    // borderRadius at THEME level (NOT theme.extend) so it REPLACES Tailwind's scale —
    // only none/sm/full exist; rounded / rounded-md / rounded-lg are removed. (ADR-077 §4)
    borderRadius: {
      none: '0',
      sm: 'var(--r-sm)',
      full: 'var(--r-pill)',
    },
    extend: {
      colors: {
        // --- Kvorum design palette (tokens.css) ---
        bg: { DEFAULT: 'var(--bg)', 2: 'var(--bg-2)', 3: 'var(--bg-3)' },
        ink: { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', 3: 'var(--ink-3)', 4: 'var(--ink-4)' },
        line: { DEFAULT: 'var(--line)', 2: 'var(--line-2)', 3: 'var(--line-3)' },
        warn: { DEFAULT: 'var(--warn)', bg: 'var(--warn-bg)', ink: 'var(--warn-ink)' },
        note: { DEFAULT: 'var(--note)', bg: 'var(--note-bg)', ink: 'var(--note-ink)' },
        ok: { DEFAULT: 'var(--ok)', bg: 'var(--accent-bg)', ink: 'var(--accent-ink)' },
        ai: { bg: 'var(--ai-bg)', line: 'var(--ai-line)', mark: 'var(--ai-mark)' },
        vote: { for: 'var(--for)', against: 'var(--against)', abstain: 'var(--abstain)' },
        dao: {
          // DEFAULT tints the pill border; `ink` is the (theme-aware) text colour.
          compound: { DEFAULT: 'var(--dao-compound)', ink: 'var(--dao-compound-ink)' },
          uniswap: { DEFAULT: 'var(--dao-uniswap)', ink: 'var(--dao-uniswap-ink)' },
          aave: { DEFAULT: 'var(--dao-aave)', ink: 'var(--dao-aave-ink)' },
          arb: { DEFAULT: 'var(--dao-arb)', ink: 'var(--dao-arb-ink)' },
          op: 'var(--dao-op)',
          ens: 'var(--dao-ens)',
          lido: 'var(--dao-lido)',
          mkr: 'var(--dao-mkr)',
        },
        paper: 'var(--paper)',

        // --- shadcn semantic layer → tokens (brand green = primary; see ADR-077 §2) ---
        background: 'var(--bg)',
        foreground: 'var(--ink)',
        card: { DEFAULT: 'var(--bg-2)', foreground: 'var(--ink)' },
        popover: { DEFAULT: 'var(--bg-2)', foreground: 'var(--ink)' },
        primary: { DEFAULT: 'var(--accent)', foreground: 'var(--paper)' }, // brand terminal-green
        secondary: { DEFAULT: 'var(--bg-3)', foreground: 'var(--ink)' },
        muted: { DEFAULT: 'var(--bg-3)', foreground: 'var(--ink-3)' },
        accent: { DEFAULT: 'var(--bg-3)', foreground: 'var(--ink)' }, // shadcn hover surface — NOT brand green
        destructive: { DEFAULT: 'var(--warn)', foreground: 'var(--paper)' },
        border: 'var(--line-2)',
        input: 'var(--line-2)',
        ring: 'var(--accent)', // brand-green focus ring (a11y §6)
      },
      maxWidth: {
        // Page content column (tokens.css --max-page). The centered <main> gutter
        // container matches the reference hi-fi (main.home max-width + margin auto).
        page: 'var(--max-page)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // named entries from the --fs-* scale (additive to Tailwind defaults)
        micro: ['10px', { lineHeight: '1.35' }], // mono micro (kbd, sub-labels)
        caption: ['10.5px', { lineHeight: '1.35' }], // section labels, src tags
        pill: ['11px', { lineHeight: '1.2' }],
        'mono-body': ['11.5px', { lineHeight: '1.5' }],
        small: ['12px', { lineHeight: '1.5' }],
        dense: ['12.5px', { lineHeight: '1.5' }],
        body: ['13px', { lineHeight: '1.5' }],
        'body-lg': ['14px', { lineHeight: '1.62' }],
        lead: ['16px', { lineHeight: '1.5' }],
        h3: ['20px', { lineHeight: '1.35' }],
        h2: ['24px', { lineHeight: '1.2' }],
        h1: ['30px', { lineHeight: '1.2' }],
        hero: ['40px', { lineHeight: '1.2' }],
      },
      keyframes: {
        // LiveDot pulse — an expanding, fading --ok ring (references the token, no hex).
        'kv-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 color-mix(in oklab, var(--ok), transparent 60%)' },
          '50%': { boxShadow: '0 0 0 5px color-mix(in oklab, var(--ok), transparent 90%)' },
        },
      },
      animation: {
        'kv-pulse': 'kv-pulse 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
