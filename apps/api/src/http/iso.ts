export function isoSeconds(value: Date | null): string | null {
  if (value === null) {
    return null;
  }

  return `${value.toISOString().slice(0, 19)}Z`;
}
