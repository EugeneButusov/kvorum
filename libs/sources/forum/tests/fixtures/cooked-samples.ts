// HTML→Markdown fixtures for the ADR-034 turndown pipeline.
//
// The `real*` fragments are captured verbatim from research.lido.fi (Discourse) so the pipeline is
// tested against production markup, not an idealised approximation. A few synthetic cases below
// cover elements the sampled thread happened not to contain (fenced code, GFM tables).

export interface CookedCase {
  name: string;
  html: string;
  /** A substring (or several) the normalised Markdown MUST contain. */
  expect: string[];
  /** Substrings the output must NOT contain (e.g. leftover HTML/chrome). */
  reject?: string[];
}

export const realMentionHtml = '<a class="mention" href="/u/izzy">@Izzy</a>';

export const realEmojiHtml =
  '<img src="https://emoji.discourse-cdn.com/apple/slight_smile.png?v=15" title=":slight_smile:" class="emoji" alt=":slight_smile:" loading="lazy" width="20" height="20">';

export const realAvatarImageHtml =
  '<img alt="" width="24" height="24" src="https://dub1.discourse-cdn.com/flex013/user_avatar/research.lido.fi/xamov.xbt/48/6953_2.png" class="avatar">';

export const realBlockquoteHtml =
  '<blockquote>\n<p>Transition to an Open RFP Model and Independent Oversight</p>\n</blockquote>';

export const realOneboxHtml = `<aside class="onebox allowlistedgeneric" data-onebox-src="https://www.datawallet.com/crypto/ethereum-staking-statistics-and-trends">
  <header class="source">
    <a href="https://www.datawallet.com/crypto/ethereum-staking-statistics-and-trends" target="_blank" rel="noopener nofollow ugc">datawallet.com</a>
  </header>
</aside>`;

export const cookedCases: CookedCase[] = [
  {
    name: 'headings → atx',
    html: '<h1>Title</h1><h3>Sub</h3>',
    expect: ['# Title', '### Sub'],
    reject: ['<h1>', '<h3>'],
  },
  {
    name: 'unordered + ordered lists',
    html: '<ul><li>alpha</li><li>beta</li></ul><ol><li>one</li><li>two</li></ol>',
    expect: ['-   alpha', '-   beta', '1.  one', '2.  two'],
  },
  {
    name: 'inline code + bold + italic',
    html: '<p>Use <code>getVote()</code> with <strong>care</strong> and <em>speed</em>.</p>',
    expect: ['`getVote()`', '**care**', '*speed*'],
  },
  {
    name: 'fenced code block with language hint (Discourse lang- class)',
    html: '<pre data-code-wrap="ts"><code class="lang-ts">const x: number = 1;\n</code></pre>',
    expect: ['```ts', 'const x: number = 1;', '```'],
    reject: ['<pre', '<code'],
  },
  {
    name: 'fenced code block with no language',
    html: '<pre><code>plain text\n</code></pre>',
    expect: ['```\nplain text'],
  },
  {
    name: 'fenced code block language from data-code-wrap only',
    html: '<pre data-code-wrap="rust"><code>fn main() {}</code></pre>',
    expect: ['```rust', 'fn main() {}'],
  },
  {
    name: 'link → inline markdown',
    html: '<p>See <a href="https://lido.fi">Lido</a>.</p>',
    expect: ['[Lido](https://lido.fi)'],
  },
  {
    name: 'blockquote → > prefix (real)',
    html: realBlockquoteHtml,
    expect: ['> Transition to an Open RFP Model and Independent Oversight'],
    reject: ['<blockquote>'],
  },
  {
    name: 'GFM table',
    html: '<table><thead><tr><th>Track</th><th>Type</th></tr></thead><tbody><tr><td>Aragon</td><td>binding</td></tr></tbody></table>',
    expect: ['| Track | Type |', '| Aragon | binding |'],
    reject: ['<table>', '<td>'],
  },
  {
    name: 'horizontal rule',
    html: '<p>a</p><hr><p>b</p>',
    expect: ['---'],
  },
  {
    name: '@mention → bare handle (real)',
    html: `<p>Thanks ${realMentionHtml} for the proposal.</p>`,
    expect: ['@Izzy'],
    reject: ['/u/izzy', 'class="mention"', '[@Izzy]'],
  },
  {
    name: 'emoji image → :name: alt (real)',
    html: `<p>Nice work ${realEmojiHtml}</p>`,
    expect: [':slight_smile:'],
    reject: ['emoji.discourse-cdn.com', '[image:'],
  },
  {
    name: 'regular image → placeholder (real avatar)',
    html: realAvatarImageHtml,
    expect: ['[image: https://dub1.discourse-cdn.com'],
  },
  {
    name: 'image with alt → placeholder uses alt',
    html: '<img src="https://x/y.png" alt="chart of TVL">',
    expect: ['[image: chart of TVL]'],
    reject: ['https://x/y.png'],
  },
  {
    name: 'onebox link preview → target link (real)',
    html: realOneboxHtml,
    expect: [
      '[datawallet.com](https://www.datawallet.com/crypto/ethereum-staking-statistics-and-trends)',
    ],
    reject: ['<aside', 'onebox', 'site-icon'],
  },
  {
    name: 'HTML comment stripped',
    html: '<p>keep<!-- drop this --></p>',
    expect: ['keep'],
    reject: ['drop this'],
  },
  {
    name: 'unknown tag → text preserved',
    html: '<custom-widget>visible text</custom-widget>',
    expect: ['visible text'],
    reject: ['<custom-widget>'],
  },
];
