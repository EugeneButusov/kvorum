// On-chain Snapshot delegation contracts (Ethereum mainnet). Both are ecosystem-global single
// contracts shared by every Snapshot space; we scope ingestion to the seeded spaces.
// gitleaks:allow -- public Ethereum contract addresses, not credentials.

// Gnosis "Delegate Registry": single delegate per (delegator, space); global (id == 0x0)
// vs space-specific precedence. SetDelegate/ClearDelegate, all params indexed (topic-filterable).
export const DELEGATE_REGISTRY_ADDRESS = '0x469788fe6e9e9681c6ebf3bf78e7fd26fc015446';

// Gnosis Guild "Split Delegation": multi-delegate weighted ratios + expiration, keyed by a
// string `context` (the space) carried in event DATA (NOT indexed → cannot topic-filter by space).
export const SPLIT_DELEGATION_ADDRESS = '0xde1e8a7e184babd9f0e3af18f40634e9ed6f0905';

// Delegation lives on Ethereum mainnet for the seeded spaces; both contracts are mainnet here.
export const SNAPSHOT_DELEGATION_CHAIN_ID = '0x1';

// Approximate contract-deploy blocks; the operator verifies the exact creation block at backfill
// registration time (live polling reads from tip and does not depend on these).
export const DELEGATE_REGISTRY_DEPLOY_BLOCK = 11225329; // ~2020-11-20
export const SPLIT_DELEGATION_DEPLOY_BLOCK = 19200000; // ~2024-02

// The Snapshot spaces whose delegation we ingest (parallels snapshot_002_seed). The Delegate
// Registry topic-filters on these (+ the global id); Split Delegation drops any event whose
// decoded `context` is not in this set.
export const SNAPSHOT_DELEGATION_SPACES = [
  'lido-snapshot.eth',
  'aavedao.eth',
  'comp-vote.eth',
] as const;

export const DELEGATION_SYSTEM = {
  DELEGATE_REGISTRY: 'delegate_registry',
  SPLIT_DELEGATION: 'split_delegation',
} as const;

export const DELEGATION_EVENT_TYPE = {
  SET: 'set',
  CLEAR: 'clear',
} as const;

// Dedicated DLQ stage for snapshot delegation projection (distinct from the CH-flavored
// aave/compound `delegation_projection_stage` — this target is PG snapshot_delegation).
export const SNAPSHOT_DELEGATION_PROJECTION_STAGE = 'snapshot_delegation_projection_stage';
