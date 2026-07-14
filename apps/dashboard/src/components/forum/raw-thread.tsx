import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { MARKDOWN_PROSE_CLASS } from '@/lib/markdown';

/**
 * Raw thread (§6.12 §3): the ingested thread content — the source of truth anyone can read to verify
 * the synthesis. Stored as concatenated post bodies (no per-post breakdown), rendered as markdown.
 */
export function RawThread({ content }: { content: string | null }) {
  const trimmed = content?.trim() ?? '';
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">Thread</h2>
      {trimmed.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">
          The thread content hasn’t been ingested yet.
        </p>
      ) : (
        <div className={MARKDOWN_PROSE_CLASS}>
          <Markdown remarkPlugins={[remarkGfm]}>{trimmed}</Markdown>
        </div>
      )}
    </section>
  );
}
