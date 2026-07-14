import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Section } from '@/components/ui/section';
import { MARKDOWN_PROSE_CLASS } from '@/lib/markdown';

/**
 * Full proposal description (§6.9), rendered as GitHub-flavoured markdown. This is the source of
 * truth; the AI summary above is supplementary. Rendered on the server for SEO.
 */
export function DescriptionSection({ description }: { description: string }) {
  const trimmed = description.trim();
  return (
    <Section number="02" title="Description">
      {trimmed.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">
          This proposal has no description text.
        </p>
      ) : (
        <div className={MARKDOWN_PROSE_CLASS}>
          <Markdown remarkPlugins={[remarkGfm]}>{trimmed}</Markdown>
        </div>
      )}
    </Section>
  );
}
