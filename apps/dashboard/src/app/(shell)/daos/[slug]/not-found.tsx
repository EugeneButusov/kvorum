import { NotFoundContent } from '@/components/system/not-found-content';

// Unknown-DAO 404 (§6.15). Catches notFound() from the DAO page and any sub-page reached under an
// untracked slug. Nav comes from the (shell) layout.
export default function DaoNotFound() {
  return <NotFoundContent kind="dao" />;
}
