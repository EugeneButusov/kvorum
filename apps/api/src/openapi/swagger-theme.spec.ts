import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BOOTSTRAP_JS, FAVICON_DATA_URI } from './swagger-branding';

const THEME_CSS_PATH = resolve(__dirname, 'assets/swagger-theme.css');
const DASHBOARD_TOKENS_PATH = resolve(__dirname, '../../../dashboard/src/app/tokens.css');

/** Comments carry prose that looks like CSS (token names, selectors); drop them before parsing. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const themeCss = stripComments(readFileSync(THEME_CSS_PATH, 'utf8'));
const dashboardTokensCss = stripComments(readFileSync(DASHBOARD_TOKENS_PATH, 'utf8'));

/**
 * The font stacks are the one place the two files are meant to disagree. The dashboard names the
 * CSS variables next/font generates at build (`var(--font-inter)`); the docs page has no such
 * build step and names the vendored faces directly.
 */
const EXPECTED_DIVERGENCE = new Set(['--font-sans', '--font-mono']);

/**
 * `--name: value` pairs from every rule whose selector list matches `selector`. Both files split
 * their tokens over several blocks — tokens.css keeps colour, type, space, layout, radii and
 * motion in separate `:root` rules — so declarations are unioned rather than read from one block.
 */
function declaredTokens(css: string, selector: RegExp): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const [, selectors = '', body = ''] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!selectors.split(',').some((part) => selector.test(part.trim()))) {
      continue;
    }
    for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      if (name !== undefined && value !== undefined) {
        tokens.set(name, value.trim());
      }
    }
  }
  if (tokens.size === 0) {
    throw new Error(`no tokens declared for ${String(selector)}`);
  }
  return tokens;
}

/** Selectors of every rule in section 3, flattened out of any at-rule nesting. */
function overrideSelectors(): string[] {
  const body = themeCss.slice(themeCss.indexOf(OVERRIDES_MARKER));
  return [...body.matchAll(/([^{}]+)\{/g)]
    .flatMap(([, group]) => (group ?? '').split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith('@'));
}

const OVERRIDES_MARKER = ':root:root:root body';
// Light lives on bare `:root` in both files (the dashboard also tags it `[data-theme='light']`).
const LIGHT = /^:root(\[data-theme='light'\])?$/;
// Dark keys off Swagger's own class here, off next-themes' attribute on the dashboard.
const THEME_DARK = /^html\.dark-mode$/;
const DASHBOARD_DARK = /^:root\[data-theme='dark'\]$/;

describe('swagger theme tokens', () => {
  // The docs page carries its own copy of the palette because it is served from a different
  // origin than the dashboard and cannot import its stylesheet. This is the guard against the
  // two drifting: every token the theme declares must still agree with the dashboard's value.
  it('agrees with the dashboard on every light token it declares', () => {
    const theme = declaredTokens(themeCss, LIGHT);
    const dashboard = declaredTokens(dashboardTokensCss, LIGHT);

    const shared = [...theme.keys()].filter(
      (name) => dashboard.has(name) && !EXPECTED_DIVERGENCE.has(name),
    );
    expect(shared.length).toBeGreaterThan(20);

    for (const name of shared) {
      expect(`${name}: ${theme.get(name)}`).toBe(`${name}: ${dashboard.get(name)}`);
    }
  });

  it('agrees with the dashboard on every dark token it declares', () => {
    const theme = declaredTokens(themeCss, THEME_DARK);
    const dashboard = declaredTokens(dashboardTokensCss, DASHBOARD_DARK);

    const shared = [...theme.keys()].filter(
      (name) => dashboard.has(name) && !EXPECTED_DIVERGENCE.has(name),
    );
    expect(shared.length).toBeGreaterThan(15);

    for (const name of shared) {
      expect(`${name}: ${theme.get(name)}`).toBe(`${name}: ${dashboard.get(name)}`);
    }
  });

  // Swagger's own dark rules (`html.dark-mode .swagger-ui …`) outrank a bare `.swagger-ui …`,
  // so an unprefixed override would apply in light mode and vanish in dark — the kind of break
  // that only shows up when someone happens to look at the page with a dark OS setting.
  it('prefixes every override selector so it outranks Swagger’s dark rules', () => {
    const unprefixed = overrideSelectors().filter(
      (selector) => !selector.startsWith(':root:root:root '),
    );

    expect(unprefixed).toEqual([]);
  });

  it('references only tokens it declares', () => {
    const declared = new Set([
      ...declaredTokens(themeCss, LIGHT).keys(),
      ...declaredTokens(themeCss, THEME_DARK).keys(),
    ]);
    const used = new Set([...themeCss.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(([, n]) => n));

    expect([...used].filter((name) => name !== undefined && !declared.has(name))).toEqual([]);
  });

  it('keeps raw colours out of the override section', () => {
    const overrides = themeCss.slice(themeCss.indexOf(OVERRIDES_MARKER));
    // ADR-077 §1: hex lives only in the token block, so overrides stay theme-aware by construction.
    expect(overrides.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
  });
});

describe('swagger branding', () => {
  it('serves the brand mark as an inline favicon', () => {
    expect(FAVICON_DATA_URI.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(FAVICON_DATA_URI)).toContain('<svg');
  });

  it('reads the stored theme after Swagger has seeded its own', () => {
    // Swagger applies prefers-color-scheme after this script is evaluated, so applying the
    // stored choice only once — before its toggle exists — would let the OS win every reload.
    const readyBody = BOOTSTRAP_JS.slice(BOOTSTRAP_JS.indexOf('function onSwaggerReady'));
    expect(readyBody).toContain('applyStoredTheme();');
    expect(readyBody).toContain('watchTheme();');
    expect(BOOTSTRAP_JS).toContain('localStorage.getItem(STORAGE_KEY)');
    expect(BOOTSTRAP_JS).toContain('kv:theme');
  });

  it('is inlined verbatim, so it must not carry an unescaped backtick', () => {
    expect(BOOTSTRAP_JS).not.toContain('`');
  });
});
