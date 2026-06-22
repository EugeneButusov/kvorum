/**
 * One-off capture utility — NOT run in CI.
 * Fetches Lido Aragon Voting scripts via mainnet RPC and writes fixture JSON files.
 *
 * Usage:
 *   MAINNET_RPC_URL=https://... ts-node --esm capture.ts
 *
 * No archive node required: closed vote scripts are immutable in current storage;
 * eth_call at latest returns the same value as at any historical block (rev2 #8).
 *
 * After running, manually verify expectedLeafActionCount against an independent oracle:
 *   - lidofinance/scripts vote announcements
 *   - Lido governance portal / Aragon app vote descriptions
 *   Record the oracle source in countProvenance.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'scripts');
const VOTING_ADDRESS = '0x2e59A20f205bB85a89C53f1936454680651E618e';

// LIP-21 (objection phase) upgrade vote ID. Vote IDs >= this use the 11-field getVote ABI.
// Set conservatively — check the proxy implementation history on etherscan.
const LIP_21_VOTE_ID = 147;

// ABI fragments, era-matched (rev2 #9):
//   Pre-LIP-21: 10 return values (no `phase`)
//   Post-LIP-21: 11 return values (adds `phase` as the last field)
const GET_VOTE_ABI_PRE = [
  'function getVote(uint256 _voteId) public view returns (bool open, bool executed, uint64 startDate, uint64 snapshotBlock, uint64 supportRequired, uint64 minAcceptQuorum, uint256 yea, uint256 nay, uint256 votingPower, bytes script)',
];
const GET_VOTE_ABI_POST = [
  'function getVote(uint256 _voteId) public view returns (bool open, bool executed, uint64 startDate, uint64 snapshotBlock, uint64 supportRequired, uint64 minAcceptQuorum, uint256 yea, uint256 nay, uint256 votingPower, bytes script, uint8 phase)',
];

// Curated vote IDs to capture — span eras and complexity types.
// Adjust based on what's available. Include:
//   - Several empty-script votes (parametric votes, no on-chain execution)
//   - Several flat votes (direct calls, no forwarder nesting)
//   - ≥5 omnibus votes (Agent.forward nesting)
//   - ≥1 execute vote (Agent.execute with ETH value)
const VOTE_IDS_TO_CAPTURE: number[] = [
  // Pre-LIP-21 era (10-field getVote):
  1, 2, 3, 10, 20,
  // Post-LIP-21 era (11-field getVote):
  147, 148, 150, 155, 160, 165, 170, 175, 180, 185, 190, 195, 200, 205, 210, 215, 220, 225, 230,
  235, 240, 245, 250,
];

async function ethCall(rpcUrl: string, to: string, data: string): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to, data }, 'latest'],
    }),
  });
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(`eth_call error: ${json.error.message}`);
  return json.result ?? '0x';
}

async function capture(): Promise<void> {
  const rpcUrl = process.env['MAINNET_RPC_URL'];
  if (!rpcUrl) throw new Error('MAINNET_RPC_URL environment variable is required');

  // Import ethers dynamically so this file can live as plain TS without being included in tests.
  const { Interface } = await import('ethers');

  const preFrag = new Interface(GET_VOTE_ABI_PRE);
  const postFrag = new Interface(GET_VOTE_ABI_POST);

  mkdirSync(SCRIPTS_DIR, { recursive: true });

  for (const voteId of VOTE_IDS_TO_CAPTURE) {
    const iface = voteId >= LIP_21_VOTE_ID ? postFrag : preFrag;
    const calldata = iface.encodeFunctionData('getVote', [voteId]);

    let result: string;
    try {
      result = await ethCall(rpcUrl, VOTING_ADDRESS, calldata);
    } catch (e) {
      console.warn(`  voteId ${voteId}: RPC error — ${String(e)}`);
      continue;
    }

    if (result === '0x' || result === '0x' + '0'.repeat(64)) {
      console.warn(`  voteId ${voteId}: empty result (vote may not exist)`);
      continue;
    }

    let decoded: unknown[];
    try {
      decoded = iface.decodeFunctionResult('getVote', result) as unknown[];
    } catch (e) {
      console.warn(`  voteId ${voteId}: decode error — ${String(e)}`);
      continue;
    }

    // script is at index 9 in both ABI variants.
    const script = decoded[9] as string;

    const isEmpty = !script || script === '0x' || script === '0x00000001';
    const kind: 'empty' | 'flat' | 'omnibus' | 'execute' = isEmpty ? 'empty' : 'flat'; // Update kind manually after inspecting decoded actions.

    const fixture = {
      voteId,
      kind,
      script: script || '0x',
      expectedLeafActionCount: null as number | null,
      countProvenance:
        'PENDING — verify leaf count against lidofinance/scripts or Lido governance portal and update this field',
    };

    const filename = `vote-${String(voteId).padStart(4, '0')}.json`;
    writeFileSync(join(SCRIPTS_DIR, filename), JSON.stringify(fixture, null, 2) + '\n');
    console.log(`  voteId ${voteId}: ${kind} → ${filename}`);
  }

  console.log('\nCapture complete. Next steps:');
  console.log('1. Review each fixture JSON and set kind (empty/flat/omnibus/execute).');
  console.log('2. Run toProposalActions on each non-empty fixture to see leaf count.');
  console.log(
    '3. Cross-check leaf counts against an independent oracle and set expectedLeafActionCount + countProvenance.',
  );
}

capture().catch((e) => {
  console.error(e);
  process.exit(1);
});
