export function extractCompoundTitle(description: string): string | null {
  if (description.length === 0) return null;

  for (const rawLine of description.split('\n')) {
    const stripped = rawLine
      .trim()
      .replace(/^#+\s*/, '')
      .trim();
    if (stripped.length === 0) continue;
    if (stripped.length <= 200) return stripped;
    return `${stripped.slice(0, 199)}…`;
  }

  return null;
}
