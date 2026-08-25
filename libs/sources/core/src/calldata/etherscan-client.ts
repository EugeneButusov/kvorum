import type { Logger } from '@libs/chain';
import type { EtherscanClientLike } from './types';

export interface EtherscanClientConfig {
  apiKey: string | null;
  /** Etherscan V2 unified endpoint (e.g. https://api.etherscan.io/v2/api). */
  baseUrl: string;
  /** Hex chain ids this client will resolve; unknown ids short-circuit to a graceful miss. */
  supportedChainIds: readonly string[];
  logger?: Logger;
}

export class EtherscanClient implements EtherscanClientLike {
  private readonly supported: ReadonlySet<string>;

  constructor(private readonly config: EtherscanClientConfig) {
    this.supported = new Set(config.supportedChainIds.map((id) => id.toLowerCase()));
  }

  async fetchAbi(chainId: string, address: string): Promise<readonly unknown[] | null> {
    const decimalChainId = this.toDecimalChainId(chainId);
    if (decimalChainId === null) {
      this.config.logger?.info('etherscan_chain_not_configured', { chainId });
      return null;
    }

    const url = new URL(this.config.baseUrl);
    url.searchParams.set('chainid', decimalChainId);
    url.searchParams.set('module', 'contract');
    url.searchParams.set('action', 'getabi');
    url.searchParams.set('address', address);
    if (this.config.apiKey !== null) {
      url.searchParams.set('apikey', this.config.apiKey);
    }

    let resp: Response;
    try {
      resp = await fetch(url.toString());
    } catch (err) {
      this.config.logger?.info('etherscan_network_error', { chainId, address, error: String(err) });
      return null;
    }

    if (resp.status === 429) {
      this.config.logger?.info('etherscan_rate_limited', { chainId, address });
      return null;
    }

    if (resp.status === 404) {
      this.config.logger?.info('etherscan_not_found', { chainId, address });
      return null;
    }

    if (!resp.ok) {
      this.config.logger?.info('etherscan_http_error', { chainId, address, status: resp.status });
      return null;
    }

    let envelope: unknown;
    try {
      envelope = await resp.json();
    } catch {
      this.config.logger?.warn('etherscan_json_parse_failed', { chainId, address });
      return null;
    }

    if (
      typeof envelope !== 'object' ||
      envelope === null ||
      (envelope as Record<string, unknown>)['status'] !== '1' ||
      typeof (envelope as Record<string, unknown>)['result'] !== 'string'
    ) {
      this.config.logger?.info('etherscan_abi_unavailable', {
        chainId,
        address,
        status: (envelope as Record<string, unknown> | null)?.['status'],
      });
      return null;
    }

    const resultStr = (envelope as Record<string, unknown>)['result'] as string;
    let abi: unknown;
    try {
      abi = JSON.parse(resultStr);
    } catch {
      this.config.logger?.warn('etherscan_abi_parse_failed', { chainId, address });
      return null;
    }

    if (!Array.isArray(abi)) {
      this.config.logger?.warn('etherscan_abi_not_array', { chainId, address });
      return null;
    }

    this.config.logger?.info('etherscan_abi_fetched', {
      chainId,
      address,
      fragmentCount: abi.length,
    });
    return abi as readonly unknown[];
  }

  /**
   * Convert a supported hex chain id (e.g. `0xa86a`) to the decimal string the V2 `chainid`
   * param expects (e.g. `43114`). Returns null for chains outside the allowlist or malformed ids.
   */
  private toDecimalChainId(chainId: string): string | null {
    const normalised = chainId.toLowerCase();
    if (!this.supported.has(normalised)) return null;
    try {
      return BigInt(normalised).toString(10);
    } catch {
      return null;
    }
  }
}
