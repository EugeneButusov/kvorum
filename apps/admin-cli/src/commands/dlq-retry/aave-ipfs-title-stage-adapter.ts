import { ProposalRepository, pgDb, type IngestionDlq } from '@libs/db';
import { AaveIpfsTitleFetcher } from '@sources/aave';
import type { DlqRetryAdapter, RetryOutcome } from './dlq-retry-adapter.js';

interface AaveIpfsTitleStageAdapterDeps {
  fetcher?: Pick<AaveIpfsTitleFetcher, 'fetchTitleDescription'>;
  proposals?: Pick<ProposalRepository, 'updateTitleDescription'>;
}

function parsePayload(payload: unknown): { proposalId: string; ipfsHash: string } {
  if (payload == null || typeof payload !== 'object') {
    throw new Error('aave ipfs title DLQ payload is not an object');
  }

  const rec = payload as Record<string, unknown>;
  const proposalId = rec['proposal_id'];
  const ipfsHash = rec['ipfs_hash'];

  if (typeof proposalId !== 'string' || proposalId.length === 0) {
    throw new Error('aave ipfs title DLQ payload is missing proposal_id');
  }
  if (typeof ipfsHash !== 'string' || ipfsHash.length === 0) {
    throw new Error('aave ipfs title DLQ payload is missing ipfs_hash');
  }

  return { proposalId, ipfsHash };
}

export class AaveIpfsTitleStageAdapter implements DlqRetryAdapter {
  readonly stage = 'aave_ipfs_title_fetch';
  private readonly fetcher: Pick<AaveIpfsTitleFetcher, 'fetchTitleDescription'>;
  private readonly proposals: Pick<ProposalRepository, 'updateTitleDescription'>;

  constructor(deps: AaveIpfsTitleStageAdapterDeps = {}) {
    this.fetcher =
      deps.fetcher ??
      new AaveIpfsTitleFetcher({
        gatewayUrl: process.env['IPFS_GATEWAY_URL'],
        fallbackGatewayUrl: process.env['IPFS_GATEWAY_FALLBACK_URL'],
        timeoutMs:
          process.env['IPFS_FETCH_TIMEOUT_MS'] == null
            ? undefined
            : Number(process.env['IPFS_FETCH_TIMEOUT_MS']),
      });
    this.proposals = deps.proposals ?? new ProposalRepository(pgDb);
  }

  async retry(dlqEntry: IngestionDlq): Promise<RetryOutcome> {
    const { proposalId, ipfsHash } = parsePayload(dlqEntry.payload);
    const result = await this.fetcher.fetchTitleDescription(ipfsHash);

    if (result.kind === 'resolved') {
      await this.proposals.updateTitleDescription(proposalId, result.title, result.description);
      return { status: 'resolved', reason: 'aave ipfs title re-fetch succeeded' };
    }

    if (result.kind === 'no_title') {
      return { status: 'resolved', reason: 'aave ipfs title unavailable; placeholder retained' };
    }

    throw new Error(`aave ipfs title re-fetch failed: ${result.reason}`);
  }
}
