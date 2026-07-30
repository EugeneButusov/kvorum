// SPEC §5.7 / KNOWN-016 — v1 synthesizes English threads only; non-English threads are skipped with
// a `_meta.skipped_reason` marker rather than synthesized poorly. This is a coarse, zero-dependency
// gate (no language library exists in the repo) that runs before the LLM call.
//
// Heuristic: of the *letters* in the content (digits/punctuation/whitespace ignored, so hex addresses,
// timestamps and code don't skew it), what fraction belong to a non-Latin script (CJK, Cyrillic,
// Arabic, Hangul, Hebrew, …)? A thread is treated as non-English only when that fraction is a majority
// — so it catches wholly-non-English threads (the real case: Chinese in some Aave threads) while
// essentially never false-skipping an English thread that merely quotes a few foreign characters.
// Blind spot: Latin-script non-English (Spanish/French) reads as English and degrades gracefully to an
// English-prompt synthesis. Proper detection is v1.1 (KNOWN-016).

/** Non-Latin letters may be at most this fraction of all letters before a thread is deemed non-English. */
const NON_LATIN_SKIP_THRESHOLD = 0.5;

export function isLikelyEnglish(rawContent: string): boolean {
  const allLetters = rawContent.match(/\p{L}/gu)?.length ?? 0;
  if (allLetters === 0) return true; // nothing to judge on → don't skip
  const latinLetters = rawContent.match(/\p{Script=Latin}/gu)?.length ?? 0;
  const nonLatinFraction = (allLetters - latinLetters) / allLetters;
  return nonLatinFraction < NON_LATIN_SKIP_THRESHOLD;
}
