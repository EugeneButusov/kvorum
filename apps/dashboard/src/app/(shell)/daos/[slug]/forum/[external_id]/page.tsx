import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { ForumHeader } from '@/components/forum/forum-header';
import { ForumSynthesis } from '@/components/forum/forum-synthesis';
import { RawThread } from '@/components/forum/raw-thread';
import { serverApi } from '@/lib/api/client';
import { fetchForumThread, type ForumThreadView } from '@/lib/forum/thread';

type Params = Promise<{ slug: string; external_id: string }>;

// Deduped so generateMetadata and the page share one fetch.
const loadThread = cache(
  (slug: string, externalId: string): Promise<ForumThreadView | null> =>
    fetchForumThread(serverApi(), slug, externalId),
);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, external_id } = await params;
  const thread = await loadThread(slug, external_id);
  if (!thread) return { title: 'Forum thread not found — Kvorum' };
  const title = thread.title ?? `Forum thread #${thread.externalId}`;
  return {
    title: `${title} — ${slug} — Kvorum`,
    description: `Governance discussion thread linked to ${slug} proposals.`,
  };
}

export default async function ForumThreadPage({ params }: { params: Params }) {
  const { slug, external_id } = await params;
  const thread = await loadThread(slug, external_id);
  if (!thread) notFound();

  return (
    <div className="flex flex-col gap-10">
      <ForumHeader thread={thread} />
      <ForumSynthesis sourceHref={thread.sourceUrl} />
      <RawThread content={thread.rawContent} />
    </div>
  );
}
