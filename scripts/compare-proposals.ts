#!/usr/bin/env npx tsx
/**
 * Compare Compound proposals between our API and Tally to identify gaps.
 *
 * Usage:
 *   npx tsx scripts/compare-proposals.ts \
 *     --our-api-key <bearer-token> \
 *     --tally-api-key <tally-key> \
 *     [--our-api-url http://localhost:3001]
 */

import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// Hardcoded Compound config
// ---------------------------------------------------------------------------

const DAO_SLUG = 'compound';
const TALLY_ORG_ID = '2206072050458560433';
const CHAIN_ID = 1; // Ethereum mainnet

// Governors we index — keyed by Tally CAIP-10 governor ID for fast lookup.
const KNOWN_GOVERNORS: Record<string, { sourceType: string; label: string }> = {
  [`eip155:${CHAIN_ID}:0xc0dA01a04C3f3E0be433606045bB7017A7323E38`]: {
    sourceType: 'compound_governor_alpha',
    label: 'Governor Alpha',
  },
  [`eip155:${CHAIN_ID}:0xc0Da02939E1441F497fd74F78cE7Decb17B66529`]: {
    sourceType: 'compound_governor_bravo',
    label: 'Governor Bravo',
  },
};

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    'our-api-key': { type: 'string' },
    'tally-api-key': { type: 'string' },
    'our-api-url': { type: 'string', default: 'http://localhost:3001' },
  },
  strict: true,
});

const ourApiKey = args['our-api-key'];
const tallyApiKey = args['tally-api-key'];
const ourApiUrl = args['our-api-url']!;

if (!ourApiKey || !tallyApiKey) {
  console.error('Required: --our-api-key, --tally-api-key');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OurProposal {
  source_id: string;
  source_type: string;
  title: string | null;
  state: string;
  voting_starts_at: string | null;
}

interface TallyProposal {
  id: string;
  onchainId: string;
  governor: { id: string };
  metadata: { title: string } | null;
  status: string;
  block: { number: string; timestamp: string } | null;
}

// ---------------------------------------------------------------------------
// Fetch all proposals from our API (both source types via DAO slug)
// ---------------------------------------------------------------------------

async function fetchOurProposals(): Promise<OurProposal[]> {
  const results: OurProposal[] = [];
  let cursor: string | undefined;
  let page = 1;

  process.stdout.write(`Fetching our proposals for '${DAO_SLUG}'...`);

  while (true) {
    const url = new URL(`${ourApiUrl}/v1/daos/${DAO_SLUG}/proposals`);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${ourApiKey}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Our API ${res.status}: ${body}`);
    }

    const json = (await res.json()) as {
      data: OurProposal[];
      pagination: { next_cursor?: string };
    };

    results.push(...json.data);
    process.stdout.write(` [page ${page}: +${json.data.length}]`);

    if (!json.pagination.next_cursor) break;
    cursor = json.pagination.next_cursor;
    page++;
  }

  console.log(` → ${results.length} total`);
  return results;
}

// ---------------------------------------------------------------------------
// Fetch all Compound proposals from Tally via organizationId
// ---------------------------------------------------------------------------

const TALLY_QUERY = `
  query Proposals($input: ProposalsInput!) {
    proposals(input: $input) {
      nodes {
        ... on Proposal {
          id
          onchainId
          governor {
            id
          }
          metadata {
            title
          }
          status
          block {
            ... on Block {
              number
              timestamp
            }
          }
        }
      }
      pageInfo {
        lastCursor
      }
    }
  }
`;

async function tallyFetch(variables: unknown): Promise<{
  proposals: {
    nodes: TallyProposal[];
    pageInfo: { lastCursor: string | null };
  };
}> {
  let res!: Response;
  for (let attempt = 1; attempt <= 5; attempt++) {
    res = await fetch('https://api.tally.xyz/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': tallyApiKey!,
      },
      body: JSON.stringify({ query: TALLY_QUERY, variables }),
    });
    if (res.status !== 429) break;
    const wait = attempt * 3000;
    process.stdout.write(` [429, retrying in ${wait / 1000}s]`);
    await new Promise((r) => setTimeout(r, wait));
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tally API ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    data?: { proposals: { nodes: TallyProposal[]; pageInfo: { lastCursor: string | null } } };
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new Error(`Tally GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
  }

  return json.data!;
}

async function fetchTallyProposals(): Promise<TallyProposal[]> {
  const results: TallyProposal[] = [];
  let afterCursor: string | undefined;
  let page = 1;

  process.stdout.write(`Fetching Tally proposals for org ${TALLY_ORG_ID}...`);

  while (true) {
    const data = await tallyFetch({
      input: {
        filters: { organizationId: TALLY_ORG_ID },
        page: { limit: 20, ...(afterCursor ? { afterCursor } : {}) },
        sort: { sortBy: 'id', isDescending: false },
      },
    });

    const { nodes, pageInfo } = data.proposals;
    results.push(...nodes);
    process.stdout.write(` [page ${page}: +${nodes.length}]`);

    if (!pageInfo.lastCursor || nodes.length === 0) break;
    afterCursor = pageInfo.lastCursor;
    page++;
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(` → ${results.length} total`);
  return results;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function report(our: OurProposal[], tally: TallyProposal[]): void {
  // Group Tally proposals by governor ID.
  const tallyByGovernor = new Map<string, TallyProposal[]>();
  for (const p of tally) {
    const govId = p.governor.id;
    if (!tallyByGovernor.has(govId)) tallyByGovernor.set(govId, []);
    tallyByGovernor.get(govId)!.push(p);
  }

  let totalMissingFromUs = 0;
  let totalExtraInUs = 0;

  // Report for each known governor.
  for (const [tallyGovId, { sourceType, label }] of Object.entries(KNOWN_GOVERNORS)) {
    const tallyForGov = tallyByGovernor.get(tallyGovId) ?? [];
    const ourForType = our.filter((p) => p.source_type === sourceType);
    const ourIds = new Set(ourForType.map((p) => p.source_id));
    const tallyIds = new Set(tallyForGov.map((p) => p.onchainId));

    const missingFromUs = tallyForGov.filter((p) => !ourIds.has(p.onchainId));
    const extraInUs = ourForType.filter((p) => !tallyIds.has(p.source_id));
    totalMissingFromUs += missingFromUs.length;
    totalExtraInUs += extraInUs.length;

    console.log(`\n=== ${label.toUpperCase()} (${sourceType}) ===`);
    console.log(`  Our system:  ${ourForType.length}`);
    console.log(`  Tally:       ${tallyForGov.length}`);
    console.log(`  Delta:       ${tallyForGov.length - ourForType.length}`);

    console.log(`\n  In Tally but NOT in our system (${missingFromUs.length}):`);
    if (missingFromUs.length === 0) {
      console.log('    (none)');
    } else {
      for (const p of missingFromUs) {
        const ts = p.block?.timestamp ?? 'unknown';
        const blockNum = p.block?.number ?? '?';
        console.log(
          `    onchainId=${String(p.onchainId).padEnd(6)}  block=${blockNum}  ts=${ts}  status=${p.status.padEnd(10)}  title=${JSON.stringify((p.metadata?.title ?? '').slice(0, 60))}`,
        );
      }
      console.log(`\n  Missing onchain IDs: ${missingFromUs.map((p) => p.onchainId).join(',')}`);
    }

    console.log(`\n  In our system but NOT in Tally (${extraInUs.length}):`);
    if (extraInUs.length === 0) {
      console.log('    (none)');
    } else {
      for (const p of extraInUs) {
        console.log(
          `    source_id=${p.source_id.padEnd(6)}  state=${p.state.padEnd(10)}  starts=${p.voting_starts_at ?? 'null'}  title=${JSON.stringify((p.title ?? '').slice(0, 60))}`,
        );
      }
    }

    // Remove from map so we can detect unknown governors below.
    tallyByGovernor.delete(tallyGovId);
  }

  // Any remaining Tally governors we don't index.
  for (const [govId, proposals] of tallyByGovernor) {
    totalMissingFromUs += proposals.length;
    console.log(`\n=== UNKNOWN GOVERNOR (not indexed by us): ${govId} ===`);
    console.log(`  Tally: ${proposals.length} proposals — we have 0`);
    for (const p of proposals) {
      const ts = p.block?.timestamp ?? 'unknown';
      console.log(
        `    onchainId=${String(p.onchainId).padEnd(6)}  ts=${ts}  status=${p.status.padEnd(10)}  title=${JSON.stringify((p.metadata?.title ?? '').slice(0, 60))}`,
      );
    }
  }

  console.log('\n=== OVERALL ===');
  console.log(`  Our system:        ${our.length}`);
  console.log(`  Tally (combined):  ${tally.length}`);
  console.log(`  Missing from us:   ${totalMissingFromUs}`);
  console.log(`  Extra in us:       ${totalExtraInUs}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== Compound Proposal Comparison: Our API vs Tally ===\n');

  const [ourProposals, tallyProposals] = await Promise.all([
    fetchOurProposals(),
    fetchTallyProposals(),
  ]);

  report(ourProposals, tallyProposals);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
