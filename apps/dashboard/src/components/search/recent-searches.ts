const STORAGE_KEY = 'kv:recent-searches';
const MAX_RECENT = 5;

export function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function addRecentSearch(query: string): void {
  try {
    const trimmed = query.trim();
    if (!trimmed) return;
    const current = getRecentSearches();
    const next = [trimmed, ...current.filter((q) => q !== trimmed)].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable
  }
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable
  }
}
