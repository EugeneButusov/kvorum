// Discourse HTTP response shapes and the transport-layer domain types the client returns.
//
// Following the Snapshot precedent, the raw `*Raw` / `*Response` interfaces type only the fields
// the crawl consumes; everything else Discourse returns stays untyped. The client maps them to the
// camelCase `Discourse*` domain types below (distinct from the `ForumThread` DB row in
// persistence/schema.ts) so snake_case never leaks past the client boundary.

// ── Raw Discourse JSON (snake_case, as returned by the API) ─────────────────────

/** An entry in `topic_list.topics[]` from `/c/{slug}/{id}.json`. */
export interface DiscourseTopicListItemRaw {
  id: number;
  title: string;
  slug: string;
  posts_count: number;
  created_at: string;
  /** Time of the latest post; absent on an empty topic. */
  last_posted_at?: string | null;
  category_id?: number | null;
  tags?: string[] | null;
}

export interface DiscourseCategoryPageResponse {
  topic_list?: {
    topics?: DiscourseTopicListItemRaw[] | null;
    /** Relative next-page URL; ABSENT once the last page is reached (the stop signal). */
    more_topics_url?: string | null;
  } | null;
}

/** A post from `post_stream.posts[]` (topic or posts endpoint). */
export interface DiscoursePostRaw {
  id: number;
  username: string;
  created_at: string;
  /** Server-rendered HTML body — the turndown pipeline input. */
  cooked: string;
  post_number: number;
}

export interface DiscourseTopicResponse {
  id: number;
  title: string;
  posts_count: number;
  created_at: string;
  last_posted_at?: string | null;
  post_stream?: {
    posts?: DiscoursePostRaw[] | null;
    /** The FULL ordered list of post ids in the thread. `/t/{id}.json` truncates `posts` to
     *  ~20 but always returns the complete `stream`; the client walks it to defeat truncation. */
    stream?: number[] | null;
  } | null;
}

export interface DiscoursePostsResponse {
  post_stream?: {
    posts?: DiscoursePostRaw[] | null;
  } | null;
}

/** `/categories.json` — the slug→numeric-id map (a category page needs the id). */
export interface DiscourseCategoriesResponse {
  category_list?: {
    categories?: { id: number; slug: string; name?: string | null }[] | null;
  } | null;
}

export interface DiscourseCategory {
  id: number;
  slug: string;
  name: string | null;
}

// ── Transport-layer domain types (camelCase, returned by DiscourseClient) ────────

/** A topic as listed on a category page — the crawl work-list unit. */
export interface DiscourseTopicSummary {
  topicId: number;
  title: string;
  slug: string;
  postCount: number;
  createdAt: string;
  lastActivityAt: string | null;
  tags: string[];
}

/** A single forum post, ready for the turndown pipeline. */
export interface DiscoursePost {
  id: number;
  username: string;
  /** ISO-8601 timestamp as Discourse returns it (used verbatim in the per-post header). */
  createdAt: string;
  cooked: string;
  postNumber: number;
}

/** A fully-assembled thread: every post walked from `post_stream.stream`, in stream order. */
export interface DiscourseThread {
  topicId: number;
  title: string;
  postCount: number;
  createdAt: string;
  lastActivityAt: string | null;
  posts: DiscoursePost[];
}
