/** Returns a per-event classifier that maps a block number to 'confirmed' or 'pending'
 *  based on a settled cutoff block.
 *
 *  blockNumber <= cutoffBlock  => 'confirmed'
 *  blockNumber >  cutoffBlock  => 'pending' */
export function makeCutoffClassifier(
  cutoffBlock: bigint,
): (blockNumber: bigint) => 'confirmed' | 'pending' {
  return (blockNumber) => (blockNumber <= cutoffBlock ? 'confirmed' : 'pending');
}
