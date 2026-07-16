import { encodeBase58 } from 'ethers';
import { parseAaveMetadata } from './metadata-parser';
import { extractAaveTitle } from './title-extractor';

export type AaveIpfsFetchResult =
  | { kind: 'resolved'; title: string; description: string }
  | { kind: 'no_title' }
  | { kind: 'error'; reason: string };

export interface AaveIpfsTitleFetcherDeps {
  fetchImpl?: typeof fetch;
  gatewayUrl?: string;
  fallbackGatewayUrl?: string;
  timeoutMs?: number;
}

export class AaveIpfsTitleFetcher {
  private readonly fetchImpl: typeof fetch;
  private readonly gateways: readonly string[];
  private readonly timeoutMs: number;

  constructor(deps: AaveIpfsTitleFetcherDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.gateways = [deps.gatewayUrl ?? 'https://ipfs.io/ipfs', deps.fallbackGatewayUrl]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map((value) => value.replace(/\/$/, ''));
    this.timeoutMs = deps.timeoutMs ?? 2_500;
  }

  async fetchTitleDescription(descriptionHash: string): Promise<AaveIpfsFetchResult> {
    const digestHex = descriptionHash.replace(/^0x/, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(digestHex)) {
      return { kind: 'error', reason: 'invalid_digest_hex' };
    }

    const cid = encodeBase58(`0x1220${digestHex}`);
    let lastError = 'unknown_error';

    for (const gateway of this.gateways) {
      const result = await this.fetchFromGateway(`${gateway}/${cid}`);
      if (result.kind === 'error') {
        lastError = result.reason;
        continue;
      }
      return result;
    }

    return { kind: 'error', reason: lastError };
  }

  private async fetchFromGateway(url: string): Promise<AaveIpfsFetchResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return { kind: 'error', reason: String(error) };
    }

    if (!response.ok) {
      return { kind: 'error', reason: `http_${response.status}` };
    }

    // Read as text, not `.json()`: Aave serves the early v2 AIPs as JSON but everything from ~2022
    // on — including every governance v3 proposal — as markdown with YAML front matter, which the
    // JSON parser rejects outright on its leading `---`.
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      return { kind: 'error', reason: `body_read_failed:${String(error)}` };
    }

    const metadata = parseAaveMetadata(text);
    if (metadata === null) {
      return { kind: 'error', reason: 'schema_mismatch' };
    }

    const title = extractAaveTitle({ title: metadata.title, description: metadata.description });

    if (title === null) return { kind: 'no_title' };
    return { kind: 'resolved', title, description: metadata.description };
  }
}
