function normalizeTitleLine(value: string): string | null {
  const stripped = value
    .trim()
    .replace(/^#+\s*/, '')
    .trim();
  if (stripped.length === 0) return null;
  if (stripped.length <= 200) return stripped;
  return `${stripped.slice(0, 199)}…`;
}

export interface AaveTitleSource {
  title?: string | null;
  description?: string | null;
}

export function extractAaveTitle(source: AaveTitleSource): string | null {
  if (typeof source.title === 'string') {
    const normalized = normalizeTitleLine(source.title);
    if (normalized !== null) return normalized;
  }

  if (typeof source.description !== 'string' || source.description.length === 0) {
    return null;
  }

  for (const rawLine of source.description.split('\n')) {
    const normalized = normalizeTitleLine(rawLine);
    if (normalized !== null) return normalized;
  }

  return null;
}
