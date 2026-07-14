import { NotFoundContent } from '@/components/system/not-found-content';

// No-activity 404 for /actors/{address} (§6.15) — a well-formed address Kvorum has no governance
// record for. Nav comes from the (shell) layout.
export default function ActorNotFound() {
  return <NotFoundContent kind="actor" />;
}
