/**
 * Repair a string whose newlines arrived escaped.
 *
 * Some governance proposals are submitted with the description JSON-encoded, so the on-chain string
 * carries the two characters `\` and `n` where a line break belongs. Markdown then renders as one
 * unbroken blob (no headings, no tables), and any code that splits the text into lines sees a single
 * enormous line.
 *
 * The guard is deliberate: only rewrite when the text has NO real newline but does contain an escape.
 * That is exactly the broken shape. A normal description is returned untouched, and so is one that
 * legitimately mentions `\n` — a code sample, say — because such text also has real line breaks.
 */
export function normalizeEscapedNewlines(text: string): string {
  if (text.includes('\n') || text.includes('\r')) return text;
  if (!/\\[nrt]/.test(text)) return text;

  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\[nr]/g, '\n')
    .replace(/\\t/g, '\t');
}
