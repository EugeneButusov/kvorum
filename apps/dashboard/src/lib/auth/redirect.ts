// Guards the post-login redirect target against open-redirect: only same-origin absolute paths are
// allowed (a leading single slash, not `//host` or a scheme). Everything else falls back to the
// developer dashboard, the default destination per §6.14.
export function safeNext(next: string | undefined | null): string {
  if (!next) return '/developer';
  if (!next.startsWith('/') || next.startsWith('//')) return '/developer';
  return next;
}
