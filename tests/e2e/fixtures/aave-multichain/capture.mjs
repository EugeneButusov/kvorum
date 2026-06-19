/**
 * capture.mjs
 *
 * Forks the real chains using Anvil and captures live logs for a chosen Aave
 * Governance V3 proposal. Writes the same 6-file fixture structure that
 * generate-fixtures.mjs produces.
 *
 * NEVER run in CI — requires archive-RPC endpoints and a local Foundry install.
 *
 * Required environment variables:
 *   MAINNET_ARCHIVE_RPC    — archive endpoint for Ethereum mainnet
 *   POLYGON_ARCHIVE_RPC    — archive endpoint for Polygon
 *   OPTIMISM_ARCHIVE_RPC   — archive endpoint for Optimism
 *   PROPOSAL_ID            — numeric proposal ID to capture (e.g. "200")
 *
 * Optional environment variables (fork-block numbers; defaults to current chain head):
 *   MAINNET_FORK_BLOCK     — mainnet block to fork at
 *   POLYGON_FORK_BLOCK     — polygon block to fork at
 *   OPTIMISM_FORK_BLOCK    — optimism block to fork at
 *
 * Optional:
 *   OUT_DIR                — output directory (default: proposal-<PROPOSAL_ID>/)
 *
 * Usage:
 *   MAINNET_ARCHIVE_RPC=https://... \
 *   POLYGON_ARCHIVE_RPC=https://... \
 *   OPTIMISM_ARCHIVE_RPC=https://... \
 *   PROPOSAL_ID=200 \
 *   node tests/e2e/fixtures/aave-multichain/capture.mjs
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const MAINNET_RPC = process.env.MAINNET_ARCHIVE_RPC;
const POLYGON_RPC = process.env.POLYGON_ARCHIVE_RPC;
const OPTIMISM_RPC = process.env.OPTIMISM_ARCHIVE_RPC;
const PROPOSAL_ID = process.env.PROPOSAL_ID;

if (!MAINNET_RPC || !POLYGON_RPC || !OPTIMISM_RPC || !PROPOSAL_ID) {
  console.error(
    'Missing required env vars. Need: MAINNET_ARCHIVE_RPC, POLYGON_ARCHIVE_RPC, ' +
      'OPTIMISM_ARCHIVE_RPC, PROPOSAL_ID',
  );
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.OUT_DIR
  ? resolve(process.env.OUT_DIR)
  : resolve(__dirname, `proposal-${PROPOSAL_ID}`);

// Contract addresses (from aave_002_seed.ts)
const GOV_ADDR = '0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7';
const VM_POL_ADDR = '0x44c8b753229006A8047A05b90379A7e92185E97C';
const PC_ETH_ADDR = '0xdAbad81aF85554E9ae636395611C58F7eC1aAEc5';
const PC_OP_ADDR = '0x0E1a3Af1f9cC76A62eD31eDedca291E63632e7c4';

// Anvil ports — one per chain
const PORTS = { mainnet: 8546, polygon: 8547, optimism: 8548 };

// ---------------------------------------------------------------------------
// JSON-RPC helpers (plain fetch, no ethers dependency)
// ---------------------------------------------------------------------------
let _rpcId = 1;

async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: _rpcId++, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
  return json.result;
}

function anvilUrl(port) {
  return `http://127.0.0.1:${port}`;
}

// ---------------------------------------------------------------------------
// Block number helper
// ---------------------------------------------------------------------------
async function getCurrentBlockNumber(rpcUrl) {
  const hex = await rpc(rpcUrl, 'eth_blockNumber');
  return parseInt(hex, 16);
}

// ---------------------------------------------------------------------------
// Anvil process management
// ---------------------------------------------------------------------------
const anvilProcs = [];

function startAnvil({ rpcUrl, forkBlock, port }) {
  return new Promise((resolve, reject) => {
    const args = ['--fork-url', rpcUrl, '--port', String(port), '--silent'];
    if (forkBlock != null) {
      args.push('--fork-block-number', String(forkBlock));
    }

    const proc = spawn('anvil', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    anvilProcs.push(proc);

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) reject(new Error(`Anvil on port ${port} did not start in time`));
    }, 30_000);

    // Poll until the RPC responds
    const poll = async () => {
      try {
        await rpc(anvilUrl(port), 'eth_blockNumber');
        clearTimeout(timeout);
        started = true;
        console.log(`  anvil ready on port ${port} (fork-block=${forkBlock ?? 'latest'})`);
        resolve(proc);
      } catch {
        if (!started) setTimeout(poll, 300);
      }
    };

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn anvil: ${err.message}. Is Foundry installed?`));
    });

    proc.on('exit', (code, signal) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Anvil exited early (code=${code}, signal=${signal})`));
      }
    });

    setTimeout(poll, 500);
  });
}

function killAll() {
  for (const proc of anvilProcs) {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* already dead */
    }
  }
}

// Cleanup on exit signals
process.on('SIGINT', () => {
  killAll();
  process.exit(130);
});
process.on('SIGTERM', () => {
  killAll();
  process.exit(143);
});

// ---------------------------------------------------------------------------
// Log fetching
// ---------------------------------------------------------------------------

/**
 * Pad a number or bigint to a 32-byte (64 hex char) topic, zero-padded on the left.
 * Works for both addresses and uint256 values.
 */
function toTopic(value) {
  const hex = BigInt(value).toString(16);
  return '0x' + hex.padStart(64, '0');
}

/**
 * Fetch logs from an anvil fork using eth_getLogs.
 * `fromBlock` and `toBlock` are hex strings (e.g. "0x0", "latest").
 */
async function getLogs(port, address, fromBlock, toBlock, topics) {
  return rpc(anvilUrl(port), 'eth_getLogs', [
    {
      address,
      fromBlock,
      toBlock,
      topics,
    },
  ]);
}

/**
 * Convert a raw eth_getLogs result entry into the fixture log shape.
 */
function normaliseLog(raw, chainId) {
  return {
    chainId,
    address: raw.address.toLowerCase(),
    blockNumber: String(parseInt(raw.blockNumber, 16)),
    blockHash: raw.blockHash,
    txHash: raw.transactionHash,
    logIndex: parseInt(raw.logIndex, 16),
    topics: raw.topics,
    data: raw.data,
  };
}

// ---------------------------------------------------------------------------
// Block header fetching
// ---------------------------------------------------------------------------
async function getBlockHeader(port, blockNumberDecimal) {
  const hex = '0x' + BigInt(blockNumberDecimal).toString(16);
  const block = await rpc(anvilUrl(port), 'eth_getBlockByNumber', [hex, false]);
  if (!block) throw new Error(`Block ${blockNumberDecimal} not found`);
  return {
    hash: block.hash,
    timestamp: parseInt(block.timestamp, 16),
  };
}

/**
 * Collect all distinct block numbers from a list of normalised logs.
 */
function blockNumbersFromLogs(logs) {
  return [...new Set(logs.map((l) => l.blockNumber))];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const proposalIdBig = BigInt(PROPOSAL_ID);
  const proposalTopic = toTopic(proposalIdBig);

  console.log(`Capturing proposal ${PROPOSAL_ID} → ${OUT_DIR}`);
  console.log('');

  // -------------------------------------------------------------------------
  // Resolve fork-block numbers (use current head if not provided)
  // -------------------------------------------------------------------------
  console.log('Resolving fork-block numbers…');
  const [mainnetFork, polygonFork, optimismFork] = await Promise.all([
    process.env.MAINNET_FORK_BLOCK
      ? Promise.resolve(parseInt(process.env.MAINNET_FORK_BLOCK, 10))
      : getCurrentBlockNumber(MAINNET_RPC),
    process.env.POLYGON_FORK_BLOCK
      ? Promise.resolve(parseInt(process.env.POLYGON_FORK_BLOCK, 10))
      : getCurrentBlockNumber(POLYGON_RPC),
    process.env.OPTIMISM_FORK_BLOCK
      ? Promise.resolve(parseInt(process.env.OPTIMISM_FORK_BLOCK, 10))
      : getCurrentBlockNumber(OPTIMISM_RPC),
  ]);
  console.log(`  mainnet  fork-block: ${mainnetFork}`);
  console.log(`  polygon  fork-block: ${polygonFork}`);
  console.log(`  optimism fork-block: ${optimismFork}`);
  console.log('');

  // -------------------------------------------------------------------------
  // Start Anvil forks
  // -------------------------------------------------------------------------
  console.log('Starting Anvil forks…');
  try {
    await Promise.all([
      startAnvil({ rpcUrl: MAINNET_RPC, forkBlock: mainnetFork, port: PORTS.mainnet }),
      startAnvil({ rpcUrl: POLYGON_RPC, forkBlock: polygonFork, port: PORTS.polygon }),
      startAnvil({ rpcUrl: OPTIMISM_RPC, forkBlock: optimismFork, port: PORTS.optimism }),
    ]);
  } catch (err) {
    killAll();
    throw err;
  }
  console.log('');

  // -------------------------------------------------------------------------
  // Fetch logs
  // -------------------------------------------------------------------------
  console.log('Fetching logs…');

  // Governance events — filter by address + proposalId indexed topic[1]
  const [rawGovLogs, rawVmLogs, rawPcEthLogs, rawPcOpLogs] = await Promise.all([
    getLogs(PORTS.mainnet, GOV_ADDR, '0x0', 'latest', [null, proposalTopic]),
    getLogs(PORTS.polygon, VM_POL_ADDR, '0x0', 'latest', [null, proposalTopic]),
    // PayloadsController events are not filtered by proposalId (no shared indexed topic);
    // capture all events for the contract and let the consumer correlate by payload ID.
    getLogs(PORTS.mainnet, PC_ETH_ADDR, '0x0', 'latest', null),
    getLogs(PORTS.optimism, PC_OP_ADDR, '0x0', 'latest', null),
  ]);

  const mainnetGovernanceLogs = rawGovLogs.map((l) => normaliseLog(l, '0x1'));
  const polygonVmLogs = rawVmLogs.map((l) => normaliseLog(l, '0x89'));
  const mainnetPcLogs = rawPcEthLogs.map((l) => normaliseLog(l, '0x1'));
  const optimismPcLogs = rawPcOpLogs.map((l) => normaliseLog(l, '0xa'));

  console.log(`  mainnet-governance:          ${mainnetGovernanceLogs.length} logs`);
  console.log(`  polygon-voting-machine:      ${polygonVmLogs.length} logs`);
  console.log(`  mainnet-payloads-controller: ${mainnetPcLogs.length} logs`);
  console.log(`  optimism-payloads-controller:${optimismPcLogs.length} logs`);
  console.log('');

  // -------------------------------------------------------------------------
  // Fetch block headers for all blocks that appear in the captured logs
  // -------------------------------------------------------------------------
  console.log('Fetching block headers…');

  const blockHeaders = { '0x1': {}, '0x89': {}, '0xa': {} };

  async function fetchHeaders(port, chainId, logs) {
    const blockNums = blockNumbersFromLogs(logs);
    await Promise.all(
      blockNums.map(async (bn) => {
        blockHeaders[chainId][bn] = await getBlockHeader(port, bn);
      }),
    );
  }

  await Promise.all([
    fetchHeaders(PORTS.mainnet, '0x1', [...mainnetGovernanceLogs, ...mainnetPcLogs]),
    fetchHeaders(PORTS.polygon, '0x89', polygonVmLogs),
    fetchHeaders(PORTS.optimism, '0xa', optimismPcLogs),
  ]);

  // Sort block numbers within each chain numerically for deterministic output
  for (const chainId of Object.keys(blockHeaders)) {
    const sorted = Object.fromEntries(
      Object.entries(blockHeaders[chainId]).sort((a, b) => Number(a[0]) - Number(b[0])),
    );
    blockHeaders[chainId] = sorted;
  }

  console.log(
    `  collected headers for ${Object.values(blockHeaders).reduce((s, m) => s + Object.keys(m).length, 0)} blocks`,
  );
  console.log('');

  // -------------------------------------------------------------------------
  // Build expected.json — a best-effort skeleton; operators should review/edit
  // -------------------------------------------------------------------------
  // We emit a skeleton with the proposal source_id and placeholders. A full
  // expected.json requires domain knowledge about the proposal outcome that
  // only the test author can verify against the real chain.
  const expectedSkeleton = {
    _note: 'Auto-generated skeleton from capture.mjs — review and edit before committing.',
    proposal: {
      source_id: PROPOSAL_ID,
      proposer: null,
      state: null,
      voting_chain_id: '0x89',
    },
    votes: [],
    payloads: [],
    api_proposal_id_source: 'aave_governance_v3',
  };

  // -------------------------------------------------------------------------
  // Write fixture files
  // -------------------------------------------------------------------------
  mkdirSync(OUT_DIR, { recursive: true });

  function write(filename, value) {
    const path = resolve(OUT_DIR, filename);
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
    console.log(`  wrote ${path}`);
  }

  console.log('Writing fixture files…');
  write('mainnet-governance.json', mainnetGovernanceLogs);
  write('polygon-voting-machine.json', polygonVmLogs);
  write('mainnet-payloads-controller.json', mainnetPcLogs);
  write('optimism-payloads-controller.json', optimismPcLogs);
  write('block-headers.json', blockHeaders);
  write('expected.json', expectedSkeleton);

  console.log('');
  console.log('Capture complete.');
  console.log(
    'Review expected.json and fill in the proposal/payload/vote assertions before committing.',
  );
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
main()
  .then(() => {
    killAll();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Capture failed:', err.message);
    killAll();
    process.exit(1);
  });
