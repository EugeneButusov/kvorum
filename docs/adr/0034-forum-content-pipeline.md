# ADR-034 — Forum content pipeline: HTML → Markdown via turndown

- **Status**: Proposed
- **Date**: 2026-05-08
- **Spec sections affected**: 3.7
- **Related**: 5.7

## Context

SPEC §3.7 says Discourse posts are "normalized to plain text (HTML stripped, code blocks preserved)." The pipeline is otherwise unspecified.

This matters because `forum_thread.raw_content` is the input to the AI synthesis feature (§5.7), which is one of the four committed AI features (DR-012). Synthesis quality depends on input fidelity: lists, code blocks, links, and quotes carry information the synthesizer uses to identify arguments and attribute participants. Reducing everything to plain text discards that signal; preserving raw HTML bloats input tokens with structural noise.

A second concern is determinism. The content-hash cache (§5.3) is keyed on `sha256(raw_content)`. If the normalization is non-deterministic — e.g., depends on the version of an HTML parser that gets bumped — cache hits become misses on no real content change, costing money and producing duplicate AI outputs.

## Decision

The pipeline is HTML → Markdown via the `turndown` library, with a fixed configuration:

| HTML element | Markdown output |
|---|---|
| `<h1>`–`<h6>` | `#`-prefixed lines (1–6 hashes) |
| `<p>` | Preserved as paragraphs separated by blank lines |
| `<ul>`, `<ol>`, `<li>` | `-` for unordered, `1.` for ordered |
| `<code>` (inline) | Backticks |
| `<pre><code>` (block) | Triple-backtick fenced; language hint preserved if `class="language-X"` is present |
| `<a href>` | `[text](url)` — URLs are valuable input for proposal linking |
| `<img>` | `[image: <alt or src>]` — placeholder, not the binary |
| `<blockquote>` | `>`-prefixed lines |
| `<table>` | GFM Markdown table |
| `<strong>`, `<b>` | `**text**` |
| `<em>`, `<i>` | `*text*` |
| `<hr>` | `---` |
| HTML comments | Stripped |
| Unknown tags | Tag stripped, text content preserved |

Posts in a thread are concatenated with `\n\n---\n\n` separators. Each post is preceded by a metadata line: `**@{username}** at {iso8601_timestamp}`.

The `turndown` version is pinned in `package.json`. The rule configuration is fixed in code (`libs/forum/turndown-config.ts`). A new field `forum_thread.content_pipeline_version` (text, NEW) records the pipeline identity at ingestion time (e.g., `turndown@7.1.2+rules-v1`). When the pipeline version bumps, existing rows retain their old version label and old `raw_content`; only freshly-crawled posts use the new pipeline. This preserves cache determinism: the same crawled HTML always produces the same `raw_content` for the same pipeline version.

When the pipeline version changes, a one-time backfill job (operator-triggered) re-normalizes existing threads. Because `raw_content` changes, content-hash AI cache entries miss and AI features regenerate against the new input — the operator weighs this cost against the quality gain.

## Alternatives considered

- **Plain text only (strip all HTML).** Loses structure that aids synthesis. Some Lido governance posts include detailed tables and code; flattening them produces incoherent input.
- **Preserve raw HTML.** Bloats input tokens by 30–50% with structural wrappers. AI cost rises proportionally for no quality gain.
- **Custom Markdown variant.** Reinvents turndown. A maintained library is the better choice.
- **Defer the choice to implementation.** Defers the determinism problem and risks pipeline drift across worker deployments.

## Consequences

- Input to AI synthesis is structurally informative without being heavyweight. Token counts in §5.7's cost estimates remain accurate.
- The pipeline is deterministic for a given pipeline version. The §5.3 content-hash cache is reliable.
- Pipeline version changes are forward-compatible: old rows keep their old `raw_content`; new rows use the new pipeline; mixing is safe.
- The `forum_thread` schema gains the `content_pipeline_version` field. Existing rows (none yet — v1 hasn't shipped) would default to the v1 pipeline.
- §3.7's normalization paragraph is updated to reference this ADR for the precise rules.
