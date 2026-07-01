import TurndownService from 'turndown';
import { tables } from './gfm';

// Minimal structural view of the DOM node turndown hands each rule. Domino (turndown's bundled
// parser) implements these; typed here so we don't depend on the `DOM` lib (this package is
// `lib: ["ES2023"]`), which would clash with @types/node's global fetch/Response.
interface TdElement {
  nodeName: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): TdElement | null;
}

function asElement(node: unknown): TdElement {
  return node as TdElement;
}

/** Pull a language hint from a code element's class (`language-`, `lang-`, or Discourse's
 *  `highlight-`), else the `<pre data-code-wrap>` attribute; '' when none is present. */
function fenceLanguage(pre: TdElement, code: TdElement | null): string {
  const cls = code?.getAttribute('class') ?? '';
  const match = cls.match(/(?:language|lang|highlight)-([\w+#.-]+)/i);
  if (match?.[1]) return match[1].toLowerCase();
  const wrap = pre.getAttribute('data-code-wrap');
  return wrap ? wrap.toLowerCase() : '';
}

/**
 * Builds the ADR-034 turndown pipeline. The configuration is fixed in code; any change to it must
 * bump the rules version in content-pipeline.ts so the content-hash cache stays deterministic.
 *
 * Beyond turndown's defaults (headings→`#`, lists, `>` quotes, `**`/`*`, links, `---`) plus the GFM
 * `tables` plugin, four rules tailor Discourse's `cooked` HTML (semantic strip):
 *  - code blocks preserve a language hint from `lang-`/`data-code-wrap` (Discourse's variant);
 *  - `<img>` → `[image: alt|src]`, except `class="emoji"` → its `:name:` alt;
 *  - `<a class="mention">` → plain `@user` (drop the profile link);
 *  - `<aside class="onebox">` link-preview → the target `[title](url)` (drop the card chrome).
 */
export function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    fence: '```',
  });

  service.use(tables);

  // Fenced code with a Discourse-aware language hint (turndown's built-in only reads `language-`).
  service.addRule('fencedCodeWithLang', {
    filter: (node) => asElement(node).nodeName === 'PRE',
    replacement: (_content, node, options) => {
      const pre = asElement(node);
      const code = pre.querySelector('code');
      const lang = fenceLanguage(pre, code);
      const fence = options.fence ?? '```';
      const text = ((code ?? pre).textContent ?? '').replace(/\n+$/, '');
      return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
    },
  });

  // Images → placeholder; Discourse emoji (`class="emoji"`) collapse to their `:name:` alt text.
  service.addRule('imagePlaceholder', {
    filter: 'img',
    replacement: (_content, node) => {
      const el = asElement(node);
      const alt = el.getAttribute('alt') ?? '';
      if (/\bemoji\b/.test(el.getAttribute('class') ?? '')) return alt;
      const label = alt || (el.getAttribute('src') ?? '');
      return label ? `[image: ${label}]` : '';
    },
  });

  // `@mention` anchors → bare `@user` text (the rendered content is already the handle).
  service.addRule('mention', {
    filter: (node) => {
      const el = asElement(node);
      return el.nodeName === 'A' && /\bmention\b/.test(el.getAttribute('class') ?? '');
    },
    replacement: (content) => content.trim(),
  });

  // Onebox link previews → the target link, dropping the card markup.
  service.addRule('onebox', {
    filter: (node) => {
      const el = asElement(node);
      return el.nodeName === 'ASIDE' && /\bonebox\b/.test(el.getAttribute('class') ?? '');
    },
    replacement: (_content, node) => {
      const el = asElement(node);
      const link = el.querySelector('a[href]');
      // Discourse stamps the canonical URL on `data-onebox-src`; fall back to the header link.
      const href = el.getAttribute('data-onebox-src') ?? link?.getAttribute('href') ?? '';
      if (!href) return '';
      const text = (link?.textContent ?? href).trim().replace(/\s+/g, ' ') || href;
      return `\n\n[${text}](${href})\n\n`;
    },
  });

  return service;
}
