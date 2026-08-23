// Data layer for the forum-thread page (§6.12): fetch a single Discourse thread + its linked
// proposals and normalize the generator-mistyped nullable fields.

import type { ForumSynthesisSection } from '@/lib/ai/panel';
import type { createApiClient } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';

type RawThread = components['schemas']['ForumThreadDto'];

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export type LinkedProposal = {
  sourceType: string;
  sourceId: string;
  title: string | null;
  confidence: 'high' | 'medium' | 'low';
  href: string;
};

export type ForumThreadView = {
  externalId: string;
  host: string;
  sourceUrl: string;
  title: string | null;
  rawContent: string | null;
  postCount: number | null;
  lastActivityAt: string | null;
  linkedProposals: LinkedProposal[];
};

export function normalizeThread(dto: RawThread, slug: string): ForumThreadView {
  return {
    externalId: dto.external_id,
    host: dto.host,
    sourceUrl: dto.source_url,
    title: asString(dto.title),
    rawContent: asString(dto.raw_content),
    postCount: asNumber(dto.post_count),
    lastActivityAt: asString(dto.last_activity_at),
    linkedProposals: dto.linked_proposals.map((p) => ({
      sourceType: p.source_type,
      sourceId: p.source_id,
      title: asString(p.title),
      confidence: p.confidence,
      href: `/daos/${slug}/proposals/${p.source_type}/${p.source_id}`,
    })),
  };
}

export async function fetchForumThread(
  api: ReturnType<typeof createApiClient>,
  slug: string,
  externalId: string,
): Promise<ForumThreadView | null> {
  try {
    const { data, error } = await api.GET('/v1/daos/{slug}/forum/{external_id}', {
      params: { path: { slug, external_id: externalId } },
    });
    if (error || !data) return null;
    return normalizeThread(data.data, slug);
  } catch {
    return null;
  }
}

// The thread's AI synthesis (§6.12 §2). Content-addressed by the thread's raw content, so it 404s
// until synthesised; a non-English thread returns 200 + data:null + a skip reason. Degrades to
// `failed` on an unreachable API — the page still renders the raw thread.
export async function fetchForumSynthesis(
  api: ReturnType<typeof createApiClient>,
  slug: string,
  externalId: string,
): Promise<ForumSynthesisSection> {
  try {
    const { data, response } = await api.GET('/v1/daos/{slug}/forum/{external_id}/ai/synthesis', {
      params: { path: { slug, external_id: externalId } },
    });
    if (data) {
      if (data.data === null) {
        const reason = data._meta?.skipped_reason;
        return reason ? { state: 'skipped', reason } : { state: 'coming-soon' };
      }
      return { state: 'ok', data: data.data, meta: data._meta };
    }
    return { state: response?.status === 404 ? 'coming-soon' : 'failed' };
  } catch {
    return { state: 'failed' };
  }
}
