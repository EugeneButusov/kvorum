// Shared prose styling for `react-markdown` output (proposal descriptions, forum threads). Tailwind
// child selectors keep the markdown token-faithful without a plugin.
export const MARKDOWN_PROSE_CLASS = [
  'max-w-prose text-body-lg leading-relaxed text-ink',
  // Links: brand green (Tailwind `primary` = --accent; `accent` is the shadcn hover surface =
  // --bg-3, which is near-invisible on paper — ADR-077 §2). Always underlined so they read as
  // links inside body prose, matching the design-system link treatment (accent colour + rule).
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_h1]:mt-6 [&_h1]:text-h3 [&_h1]:font-semibold',
  '[&_h2]:mt-6 [&_h2]:text-h3 [&_h2]:font-semibold',
  '[&_h3]:mt-5 [&_h3]:text-body-lg [&_h3]:font-semibold',
  '[&_p]:mt-3 [&_ul]:mt-3 [&_ol]:mt-3',
  '[&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-6 [&_li]:mt-1',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-line-2 [&_blockquote]:pl-4 [&_blockquote]:text-ink-2',
  '[&_code]:bg-bg-3 [&_code]:px-1 [&_code]:font-mono [&_code]:text-small',
  '[&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:bg-bg-3 [&_pre]:p-3',
  '[&_table]:mt-3 [&_th]:border [&_th]:border-line-3 [&_th]:px-2 [&_th]:py-1',
  '[&_td]:border [&_td]:border-line-3 [&_td]:px-2 [&_td]:py-1',
  '[&_img]:max-w-full',
].join(' ');
