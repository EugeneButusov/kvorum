import { NotFoundContent } from '@/components/system/not-found-content';

// Unknown-proposal 404 (§6.15) — the DAO is tracked but this proposal isn't in the index. Sits at
// the proposal segment so it wins over the DAO-level not-found for proposal detail URLs.
export default function ProposalNotFound() {
  return <NotFoundContent kind="proposal" />;
}
