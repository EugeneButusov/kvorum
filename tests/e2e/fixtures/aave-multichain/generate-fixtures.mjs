/**
 * generate-fixtures.mjs
 *
 * Generates synthetic fixture files for the Aave multi-chain stitch test (proposal 200).
 * Uses ethers v6 Interface.encodeEventLog to produce real ABI-encoded log data that
 * is structurally identical to what the production decoder/ingester expects.
 *
 * Run:
 *   node --input-type=module tests/e2e/fixtures/aave-multichain/generate-fixtures.mjs
 *
 * The output files are written to:
 *   tests/e2e/fixtures/aave-multichain/proposal-200/
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface } from 'ethers';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, 'proposal-200');
mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Contract addresses (from aave_002_seed.ts)
// ---------------------------------------------------------------------------
const GOV_ADDR = '0x9aee0b04504cef83a65ac3f0e838d0593bcb2bc7';
const VM_POL_ADDR = '0x44c8b753229006a8047a05b90379a7e92185e97c';
const PC_ETH_ADDR = '0xdabad81af85554e9ae636395611c58f7ec1aaec5';
const PC_OP_ADDR = '0x0e1a3af1f9cc76a62ed31ededca291e63632e7c4';

// Payload creator — a realistic but synthetic operator address
const PAYLOAD_CREATOR = '0xe3fd707583932a99513a5c65c8463de769f5dadf';
// Payload target contracts — one per chain
const PAYLOAD_TARGET_ETH = '0xc09aa853780cf5c2265560d2f0d9208522c71d36';
const PAYLOAD_TARGET_OP = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419';

// ---------------------------------------------------------------------------
// Proposal parameters
// ---------------------------------------------------------------------------
const PROPOSAL_ID = 200n;
const CREATOR = '0xd73a92be73efbfcf3854433a5fcbabf9c1316073';
const ACCESS_LEVEL = 1n;
const IPFS_HASH = '0x1212121212121212121212121212121212121212121212121212121212121212';
const SNAPSHOT_HASH = '0x1111111111111111111111111111111111111111111111111111111111111111';
const VOTING_DURATION = 604800; // 7 days in seconds (uint24)
const PAYLOAD_ETH = 10n;
const PAYLOAD_OP = 5n;
const VOTER1 = '0xa0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0';
const VOTER2 = '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0';
const FOR_VOTES = 5_000_000n * 10n ** 18n;
const AGAINST_VOTES = 100_000n * 10n ** 18n;
// voter1 contributes 3M to for-votes; voter2 contributes the full against-votes
const VOTER1_POWER = 3_000_000n * 10n ** 18n;
const VOTER2_POWER = AGAINST_VOTES;

// ---------------------------------------------------------------------------
// Block layout (realistic block numbers and timestamps)
// ---------------------------------------------------------------------------
//
// Mainnet:
//   19990000  — PC ETH: PayloadCreated (before proposal creation — payload pre-exists)
//   20000000  — GOV:    ProposalCreated + PayloadSent×2
//   20000100  — GOV:    VotingActivated  (snapshot block hash = SNAPSHOT_HASH)
//   20005000  — GOV:    ProposalQueued
//   20005100  — PC ETH: PayloadQueued
//   20006000  — GOV:    ProposalExecuted
//   20007000  — PC ETH: PayloadExecuted
//
// Polygon:
//   60000000  — VM: ProposalVoteConfigurationBridged
//   60000001  — VM: ProposalVoteStarted
//   60000100  — VM: VoteEmitted (voter1, for)
//   60000200  — VM: VoteEmitted (voter2, against)
//   60005000  — VM: ProposalResultsSent
//
// Optimism:
//   110000000 — PC OP: PayloadCreated
//   110005000 — PC OP: PayloadQueued  (no PayloadExecuted — lossy case)

const BLOCKS = {
  '0x1': {
    19990000: {
      hash: '0x3030303030303030303030303030303030303030303030303030303030303030',
      timestamp: 1719880000,
    },
    20000000: {
      hash: '0x1010101010101010101010101010101010101010101010101010101010101010',
      timestamp: 1720000000,
    },
    20000100: {
      hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      timestamp: 1720001200,
    },
    20005000: {
      hash: '0x1212121212121212121212121212121212121212121212121212121212121212',
      timestamp: 1720060000,
    },
    20005100: {
      hash: '0x3131313131313131313131313131313131313131313131313131313131313131',
      timestamp: 1720061200,
    },
    20006000: {
      hash: '0x1313131313131313131313131313131313131313131313131313131313131313',
      timestamp: 1720072000,
    },
    20007000: {
      hash: '0x3232323232323232323232323232323232323232323232323232323232323232',
      timestamp: 1720083600,
    },
  },
  '0x89': {
    60000000: {
      hash: '0x2020202020202020202020202020202020202020202020202020202020202020',
      timestamp: 1720001500,
    },
    60000001: {
      hash: '0x2121212121212121212121212121212121212121212121212121212121212121',
      timestamp: 1720001510,
    },
    60000100: {
      hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      timestamp: 1720002700,
    },
    60000200: {
      hash: '0x2323232323232323232323232323232323232323232323232323232323232323',
      timestamp: 1720003900,
    },
    60005000: {
      hash: '0x2424242424242424242424242424242424242424242424242424242424242424',
      timestamp: 1720059000,
    },
  },
  '0xa': {
    110000000: {
      hash: '0x4040404040404040404040404040404040404040404040404040404040404040',
      timestamp: 1719880200,
    },
    110005000: {
      hash: '0x4141414141414141414141414141414141414141414141414141414141414141',
      timestamp: 1720061400,
    },
  },
};

// Vote start/end derive from the Polygon block timestamp where VoteStarted is emitted
const VOTE_START_TIME = BigInt(BLOCKS['0x89']['60000001'].timestamp); // 1720001510
const VOTE_END_TIME = VOTE_START_TIME + BigInt(VOTING_DURATION); // 1720001510 + 604800 = 1720606310

// ---------------------------------------------------------------------------
// ABI interfaces
// ---------------------------------------------------------------------------
const govIface = new Interface([
  'event ProposalCreated(uint256 indexed proposalId, address indexed creator, uint8 indexed accessLevel, bytes32 ipfsHash)',
  'event PayloadSent(uint256 indexed proposalId, uint40 payloadId, address indexed payloadsController, uint256 indexed chainId, uint256 payloadNumberOnProposal, uint256 numberOfPayloadsOnProposal)',
  'event VotingActivated(uint256 indexed proposalId, bytes32 indexed snapshotBlockHash, uint24 votingDuration)',
  'event ProposalQueued(uint256 indexed proposalId, uint128 votesFor, uint128 votesAgainst)',
  'event ProposalExecuted(uint256 indexed proposalId)',
]);

const vmIface = new Interface([
  'event ProposalVoteConfigurationBridged(uint256 indexed proposalId, bytes32 indexed blockHash, uint24 votingDuration, bool indexed voteCreated)',
  'event ProposalVoteStarted(uint256 indexed proposalId, bytes32 indexed l1BlockHash, uint256 startTime, uint256 endTime)',
  'event VoteEmitted(uint256 indexed proposalId, address indexed voter, bool indexed support, uint256 votingPower)',
  'event ProposalResultsSent(uint256 indexed proposalId, uint256 forVotes, uint256 againstVotes)',
]);

const pcIface = new Interface([
  'event PayloadCreated(uint40 indexed payloadId, address indexed creator, (address target, bool withDelegateCall, uint8 accessLevel, uint256 value, string signature, bytes callData)[] actions, uint8 indexed maximumAccessLevelRequired)',
  'event PayloadQueued(uint40 payloadId)',
  'event PayloadExecuted(uint40 payloadId)',
]);

// ---------------------------------------------------------------------------
// Helper: encode a log entry into the fixture shape
// ---------------------------------------------------------------------------
function makeLog({ chainId, address, blockNumber, logIndex, txHash, iface, eventName, args }) {
  const block = BLOCKS[chainId][blockNumber];
  const { topics, data } = iface.encodeEventLog(eventName, args);
  return {
    chainId,
    address,
    blockNumber,
    blockHash: block.hash,
    txHash,
    logIndex,
    topics,
    data,
  };
}

// ---------------------------------------------------------------------------
// mainnet-governance.json
// 6 events: ProposalCreated, PayloadSent×2, VotingActivated, ProposalQueued, ProposalExecuted
// ---------------------------------------------------------------------------
const mainnetGovernance = [
  makeLog({
    chainId: '0x1',
    address: GOV_ADDR,
    blockNumber: '20000000',
    logIndex: 0,
    txHash: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
    iface: govIface,
    eventName: 'ProposalCreated',
    args: [PROPOSAL_ID, CREATOR, ACCESS_LEVEL, IPFS_HASH],
  }),
  // PayloadSent for ETH payload (chainId=1, payloadNumberOnProposal=0, total=2)
  makeLog({
    chainId: '0x1',
    address: GOV_ADDR,
    blockNumber: '20000000',
    logIndex: 1,
    txHash: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
    iface: govIface,
    eventName: 'PayloadSent',
    args: [PROPOSAL_ID, PAYLOAD_ETH, PC_ETH_ADDR, 1n, 0n, 2n],
  }),
  // PayloadSent for OP payload (chainId=10, payloadNumberOnProposal=1, total=2)
  makeLog({
    chainId: '0x1',
    address: GOV_ADDR,
    blockNumber: '20000000',
    logIndex: 2,
    txHash: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
    iface: govIface,
    eventName: 'PayloadSent',
    args: [PROPOSAL_ID, PAYLOAD_OP, PC_OP_ADDR, 10n, 1n, 2n],
  }),
  makeLog({
    chainId: '0x1',
    address: GOV_ADDR,
    blockNumber: '20000100',
    logIndex: 0,
    txHash: '0xa2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2',
    iface: govIface,
    eventName: 'VotingActivated',
    args: [PROPOSAL_ID, SNAPSHOT_HASH, VOTING_DURATION],
  }),
  makeLog({
    chainId: '0x1',
    address: GOV_ADDR,
    blockNumber: '20005000',
    logIndex: 0,
    txHash: '0xa3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3',
    iface: govIface,
    eventName: 'ProposalQueued',
    args: [PROPOSAL_ID, FOR_VOTES, AGAINST_VOTES],
  }),
  makeLog({
    chainId: '0x1',
    address: GOV_ADDR,
    blockNumber: '20006000',
    logIndex: 0,
    txHash: '0xa4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4',
    iface: govIface,
    eventName: 'ProposalExecuted',
    args: [PROPOSAL_ID],
  }),
];

// ---------------------------------------------------------------------------
// polygon-voting-machine.json
// 5 events: ProposalVoteConfigurationBridged, ProposalVoteStarted, VoteEmitted×2, ProposalResultsSent
// ---------------------------------------------------------------------------
const polygonVotingMachine = [
  makeLog({
    chainId: '0x89',
    address: VM_POL_ADDR,
    blockNumber: '60000000',
    logIndex: 0,
    txHash: '0xb1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1',
    iface: vmIface,
    eventName: 'ProposalVoteConfigurationBridged',
    args: [PROPOSAL_ID, SNAPSHOT_HASH, VOTING_DURATION, true],
  }),
  makeLog({
    chainId: '0x89',
    address: VM_POL_ADDR,
    blockNumber: '60000001',
    logIndex: 0,
    txHash: '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
    iface: vmIface,
    eventName: 'ProposalVoteStarted',
    args: [PROPOSAL_ID, SNAPSHOT_HASH, VOTE_START_TIME, VOTE_END_TIME],
  }),
  makeLog({
    chainId: '0x89',
    address: VM_POL_ADDR,
    blockNumber: '60000100',
    logIndex: 0,
    txHash: '0xb3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3',
    iface: vmIface,
    eventName: 'VoteEmitted',
    args: [PROPOSAL_ID, VOTER1, true, VOTER1_POWER],
  }),
  makeLog({
    chainId: '0x89',
    address: VM_POL_ADDR,
    blockNumber: '60000200',
    logIndex: 0,
    txHash: '0xb4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4',
    iface: vmIface,
    eventName: 'VoteEmitted',
    args: [PROPOSAL_ID, VOTER2, false, VOTER2_POWER],
  }),
  makeLog({
    chainId: '0x89',
    address: VM_POL_ADDR,
    blockNumber: '60005000',
    logIndex: 0,
    txHash: '0xb5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5',
    iface: vmIface,
    eventName: 'ProposalResultsSent',
    args: [PROPOSAL_ID, FOR_VOTES, AGAINST_VOTES],
  }),
];

// ---------------------------------------------------------------------------
// mainnet-payloads-controller.json
// 3 events: PayloadCreated, PayloadQueued, PayloadExecuted (for payload 10)
// ---------------------------------------------------------------------------
const ethPayloadAction = {
  target: PAYLOAD_TARGET_ETH,
  withDelegateCall: false,
  accessLevel: 1,
  value: 0n,
  signature: 'execute()',
  callData: '0x',
};

const mainnetPayloadsController = [
  makeLog({
    chainId: '0x1',
    address: PC_ETH_ADDR,
    blockNumber: '19990000',
    logIndex: 0,
    txHash: '0xc1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1',
    iface: pcIface,
    eventName: 'PayloadCreated',
    args: [PAYLOAD_ETH, PAYLOAD_CREATOR, [ethPayloadAction], 1n],
  }),
  makeLog({
    chainId: '0x1',
    address: PC_ETH_ADDR,
    blockNumber: '20005100',
    logIndex: 0,
    txHash: '0xc2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2',
    iface: pcIface,
    eventName: 'PayloadQueued',
    args: [PAYLOAD_ETH],
  }),
  makeLog({
    chainId: '0x1',
    address: PC_ETH_ADDR,
    blockNumber: '20007000',
    logIndex: 0,
    txHash: '0xc3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3',
    iface: pcIface,
    eventName: 'PayloadExecuted',
    args: [PAYLOAD_ETH],
  }),
];

// ---------------------------------------------------------------------------
// optimism-payloads-controller.json
// 2 events: PayloadCreated, PayloadQueued (no PayloadExecuted — the lossy case)
// ---------------------------------------------------------------------------
const opPayloadAction = {
  target: PAYLOAD_TARGET_OP,
  withDelegateCall: false,
  accessLevel: 1,
  value: 0n,
  signature: 'execute()',
  callData: '0x',
};

const optimismPayloadsController = [
  makeLog({
    chainId: '0xa',
    address: PC_OP_ADDR,
    blockNumber: '110000000',
    logIndex: 0,
    txHash: '0xd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1',
    iface: pcIface,
    eventName: 'PayloadCreated',
    args: [PAYLOAD_OP, PAYLOAD_CREATOR, [opPayloadAction], 1n],
  }),
  makeLog({
    chainId: '0xa',
    address: PC_OP_ADDR,
    blockNumber: '110005000',
    logIndex: 0,
    txHash: '0xd2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2',
    iface: pcIface,
    eventName: 'PayloadQueued',
    args: [PAYLOAD_OP],
  }),
];

// ---------------------------------------------------------------------------
// expected.json
// ---------------------------------------------------------------------------
const expected = {
  proposal: {
    source_id: '200',
    proposer: CREATOR,
    state: 'executed',
    voting_chain_id: '0x89',
  },
  votes: [
    {
      voter: VOTER1,
      support: true,
      voting_power: VOTER1_POWER.toString(),
    },
    {
      voter: VOTER2,
      support: false,
      voting_power: VOTER2_POWER.toString(),
    },
  ],
  payloads: [
    {
      target_chain_id: '0x1',
      payloads_controller: PC_ETH_ADDR,
      payload_id: PAYLOAD_ETH.toString(),
      status: 'executed',
      executed_at_destination_block: '20007000',
      actions: [
        {
          target: PAYLOAD_TARGET_ETH,
          function_signature: 'execute()',
          calldata: '0x',
          value_wei: '0',
          target_chain_id: '0x1',
        },
      ],
    },
    {
      target_chain_id: '0xa',
      payloads_controller: PC_OP_ADDR,
      payload_id: PAYLOAD_OP.toString(),
      status: 'queued',
      executed_at_destination_block: null,
      actions: [
        {
          target: PAYLOAD_TARGET_OP,
          function_signature: 'execute()',
          calldata: '0x',
          value_wei: '0',
          target_chain_id: '0xa',
        },
      ],
    },
  ],
  api_proposal_id_source: 'aave_governance_v3',
};

// ---------------------------------------------------------------------------
// Write all files
// ---------------------------------------------------------------------------
function write(filename, value) {
  const path = resolve(OUT_DIR, filename);
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
  console.log(`wrote ${path}`);
}

write('mainnet-governance.json', mainnetGovernance);
write('polygon-voting-machine.json', polygonVotingMachine);
write('mainnet-payloads-controller.json', mainnetPayloadsController);
write('optimism-payloads-controller.json', optimismPayloadsController);
write('block-headers.json', BLOCKS);
write('expected.json', expected);

console.log('done — 6 fixture files written to', OUT_DIR);
