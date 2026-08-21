import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** `--name: #hex` pairs from every rule whose selector list matches `selector`. */
function tokens(selector: RegExp): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, selectors = '', body = ''] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!selectors.split(',').some((part) => selector.test(part.trim()))) continue;
    for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8})\s*;/gi)) {
      if (name && value) found.set(name, value.toLowerCase());
    }
  }
  return found;
}

const LIGHT = tokens(/^:root(\[data-theme='light'\])?$/);
const DARK = tokens(/^:root\[data-theme='dark'\]$/);

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const channel = (pair: string): number => {
    const v = parseInt(pair, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(full.slice(0, 2)) +
    0.7152 * channel(full.slice(2, 4)) +
    0.0722 * channel(full.slice(4, 6))
  );
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pairs the design system actually paints: a saturated fill under a label. */
const FILL_PAIRS = [
  { name: 'primary button', fill: '--accent', ink: '--fill-ink' },
  { name: 'destructive button', fill: '--warn', ink: '--fill-ink' },
] as const;

describe('design tokens', () => {
  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ])('declares the tokens the %s theme needs', (_theme, set) => {
    for (const name of ['--accent', '--warn', '--fill-ink', '--ink', '--bg']) {
      expect(set.get(name)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  // The regression this exists for: --fill-ink was a theme-invariant off-white, which reads on the
  // light theme's dark green and red but leaves the dark theme's brighter fills at 1.25:1 and
  // 2.89:1 — white-on-light-green, reported as unreadable on /developer.
  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ])('keeps label-on-fill contrast at AA in the %s theme', (_theme, set) => {
    for (const pair of FILL_PAIRS) {
      const fill = set.get(pair.fill);
      const ink = set.get(pair.ink);
      expect(fill, `${pair.fill} missing`).toBeDefined();
      expect(ink, `${pair.ink} missing`).toBeDefined();

      const ratio = contrastRatio(fill as string, ink as string);
      expect(
        ratio,
        `${pair.name}: ${ink} on ${fill} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('flips the on-fill ink between themes, since the fills do', () => {
    expect(LIGHT.get('--accent')).not.toBe(DARK.get('--accent'));
    expect(LIGHT.get('--fill-ink')).not.toBe(DARK.get('--fill-ink'));
  });
});
