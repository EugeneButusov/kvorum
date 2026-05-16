/** Returns a per-event classifier that maps a block number to 'confirmed' or 'pending'
 *  based on the 2×reorgHorizon cutoff captured at backfill start (ADR-027 + ADR-046).
 *
 *  blockNumber <= cutoffBlock  ⇒  'confirmed' (buried beyond the live reorg-rescan window)
 *  blockNumber >  cutoffBlock  ⇒  'pending'   (may still be reorged by the live poller) */
export function makeCutoffClassifier(
  cutoffBlock: bigint,
): (blockNumber: bigint) => 'confirmed' | 'pending' {
  return (blockNumber) => (blockNumber <= cutoffBlock ? 'confirmed' : 'pending');
}
