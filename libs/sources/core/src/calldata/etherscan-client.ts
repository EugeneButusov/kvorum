import type { Logger } from '@libs/chain';
import type { EtherscanClientLike } from './types';

export interface EtherscanClientConfig {
  apiKey: string | null;
  /** Etherscan V2 unified endpoint (e.g. https://api.etherscan.io/v2/api). */
  baseUrl: string;
  /** Hex chain ids this client will resolve; unknown ids short-circuit to a graceful miss. */
  supportedChainIds: readonly string[];
  /** Retries on a (transient) rate-limit response before giving up. Default 2 (≤3 attempts). */
  maxRateLimitRetries?: number;
  /** Injectable sleep so tests don't wait on real timers. */
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
}

/** Outcome of a single Etherscan request, before action-specific parsing. */
type EtherscanResponse =
  | { kind: 'ok'; result: unknown }
  | { kind: 'unavailable'; status?: unknown }
  | { kind: 'rate_limited' }
  | { kind: 'error' };

const ZERO_ADDRESS_RE = /^0x0{40}$/i;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export class EtherscanClient implements EtherscanClientLike {
  private readonly supported: ReadonlySet<string>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: EtherscanClientConfig) {
    this.supported = new Set(config.supportedChainIds.map((id) => id.toLowerCase()));
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async fetchAbi(chainId: string, address: string): Promise<readonly unknown[] | null> {
    const decimalChainId = this.toDecimalChainId(chainId);
    if (decimalChainId === null) {
      this.config.logger?.info('etherscan_chain_not_configured', { chainId });
      return null;
    }

    const res = await this.request(decimalChainId, address, 'getabi');
    if (res.kind !== 'ok') {
      if (res.kind === 'unavailable') {
        this.config.logger?.info('etherscan_abi_unavailable', {
          chainId,
          address,
          status: res.status,
        });
      }
      return null;
    }

    if (typeof res.result !== 'string') {
      this.config.logger?.warn('etherscan_abi_parse_failed', { chainId, address });
      return null;
    }

    let abi: unknown;
    try {
      abi = JSON.parse(res.result);
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
   * Resolve a proxy's implementation address via `getsourcecode`. Etherscan detects both standard
   * (EIP-1967) and non-standard proxies (e.g. Compound's Unitroller) that the RPC slot-checker
   * cannot, so this is the fallback when a proxy's own ABI lacks the called selector. Returns the
   * lowercased implementation address, or null when the target is not a proxy Etherscan recognises.
   */
  async fetchImplementation(chainId: string, address: string): Promise<string | null> {
    const decimalChainId = this.toDecimalChainId(chainId);
    if (decimalChainId === null) return null;

    const res = await this.request(decimalChainId, address, 'getsourcecode');
    if (res.kind !== 'ok') return null;

    // getsourcecode returns result as an array of one metadata object (already parsed JSON).
    const row = Array.isArray(res.result) ? (res.result[0] as unknown) : null;
    if (row === null || typeof row !== 'object') return null;

    const record = row as Record<string, unknown>;
    const impl = record['Implementation'];
    if (
      record['Proxy'] === '1' &&
      typeof impl === 'string' &&
      ADDRESS_RE.test(impl) &&
      !ZERO_ADDRESS_RE.test(impl)
    ) {
      const implementation = impl.toLowerCase();
      this.config.logger?.info('etherscan_impl_resolved', { chainId, address, implementation });
      return implementation;
    }
    return null;
  }

  /** Issue a request, retrying on a transient rate-limit before returning. */
  private async request(
    decimalChainId: string,
    address: string,
    action: 'getabi' | 'getsourcecode',
  ): Promise<EtherscanResponse> {
    const maxRetries = this.config.maxRateLimitRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const res = await this.requestOnce(decimalChainId, address, action);
      if (res.kind !== 'rate_limited') return res;
      if (attempt >= maxRetries) {
        this.config.logger?.info('etherscan_rate_limited', {
          chainId: decimalChainId,
          address,
          action,
        });
        return res;
      }
      await this.sleep(Math.min(2000, 250 * 2 ** attempt));
    }
  }

  private async requestOnce(
    decimalChainId: string,
    address: string,
    action: 'getabi' | 'getsourcecode',
  ): Promise<EtherscanResponse> {
    const url = new URL(this.config.baseUrl);
    url.searchParams.set('chainid', decimalChainId);
    url.searchParams.set('module', 'contract');
    url.searchParams.set('action', action);
    url.searchParams.set('address', address);
    if (this.config.apiKey !== null) {
      url.searchParams.set('apikey', this.config.apiKey);
    }

    let resp: Response;
    try {
      resp = await fetch(url.toString());
    } catch (err) {
      this.config.logger?.info('etherscan_network_error', { address, error: String(err) });
      return { kind: 'error' };
    }

    if (resp.status === 429) return { kind: 'rate_limited' };
    if (resp.status === 404) {
      this.config.logger?.info('etherscan_not_found', { address });
      return { kind: 'unavailable' };
    }
    if (!resp.ok) {
      this.config.logger?.info('etherscan_http_error', { address, status: resp.status });
      return { kind: 'error' };
    }

    let envelope: unknown;
    try {
      envelope = await resp.json();
    } catch {
      this.config.logger?.warn('etherscan_json_parse_failed', { address });
      return { kind: 'error' };
    }

    const obj =
      typeof envelope === 'object' && envelope !== null
        ? (envelope as Record<string, unknown>)
        : null;
    const status = obj?.['status'];
    const result = obj?.['result'];

    if (status === '1') return { kind: 'ok', result };

    // Etherscan reports rate limits as HTTP 200 + status "0" + a "Max rate limit reached" message —
    // a transient, retryable condition, NOT an unverified contract. Detect it so it isn't misfiled.
    if (typeof result === 'string' && /rate limit/i.test(result)) return { kind: 'rate_limited' };

    return { kind: 'unavailable', status };
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
