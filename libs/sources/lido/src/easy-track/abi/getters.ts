import { Interface } from 'ethers';

// Read-only getter for the Easy Track reconciler. `getMotions()` returns only the **active** motions —
// a closed motion (enacted / rejected / canceled) is removed from storage via swap-and-pop — so a
// motion still present after its objection window has necessarily passed (objections stayed below
// threshold, else it would have been rejected-and-deleted). The reconciler uses that to derive the
// event-silent optimistic pass. Struct field order vendored from the deployed EasyTrack `Motion`
// (0xF0211b…); confirm against the contract before the live backfill (the same on-chain archaeology
// the ingestion adapter did for the event ABI).

export interface EasyTrackMotion {
  id: string; // decimal string
  evmScriptFactory: string;
  creator: string;
  duration: number; // seconds
  startDate: number; // unix seconds
  snapshotBlock: string;
  objectionsThreshold: string;
  objectionsAmount: string;
  evmScriptHash: string;
}

export const EASY_TRACK_GETTERS_INTERFACE = new Interface([
  'function getMotions() view returns (tuple(uint256 id, address evmScriptFactory, address creator, uint256 duration, uint256 startDate, uint256 snapshotBlock, uint256 objectionsThreshold, uint256 objectionsAmount, bytes32 evmScriptHash)[] motions)',
]);

export function encodeGetMotions(): string {
  return EASY_TRACK_GETTERS_INTERFACE.encodeFunctionData('getMotions', []);
}

export function decodeGetMotions(raw: string): EasyTrackMotion[] {
  const [motions] = EASY_TRACK_GETTERS_INTERFACE.decodeFunctionResult('getMotions', raw);
  return (motions as unknown[]).map((entry) => {
    const m = entry as ArrayLike<unknown>;
    return {
      id: (m[0] as bigint).toString(),
      evmScriptFactory: (m[1] as string).toLowerCase(),
      creator: (m[2] as string).toLowerCase(),
      duration: Number(m[3] as bigint),
      startDate: Number(m[4] as bigint),
      snapshotBlock: (m[5] as bigint).toString(),
      objectionsThreshold: (m[6] as bigint).toString(),
      objectionsAmount: (m[7] as bigint).toString(),
      evmScriptHash: m[8] as string,
    };
  });
}
