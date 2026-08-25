export interface EtherscanConfig {
  enabled: boolean;
  apiKey: string | null;
  /** Etherscan V2 unified endpoint. One key serves every supported chain via a `chainid` param. */
  baseUrl: string;
  /** Hex chain ids the client will resolve; doubles as an allowlist so we don't call V2 for chains we know it can't serve. */
  supportedChainIds: readonly string[];
}

export interface CalldataDecoderConfig {
  etherscan: EtherscanConfig;
}

const DEFAULT_BASE_URL = 'https://api.etherscan.io/v2/api';

// Hex chain ids resolvable via the Etherscan V2 unified API. Covers Compound (mainnet) and Aave's
// governance/voting/payload-execution chains. The client converts these to decimal for the request.
const DEFAULT_SUPPORTED_CHAIN_IDS: readonly string[] = [
  '0x1', // Ethereum
  '0xa', // Optimism
  '0x89', // Polygon
  '0x64', // Gnosis
  '0x2105', // Base
  '0xa4b1', // Arbitrum One
  '0xa86a', // Avalanche C-Chain
];

export function readCalldataDecoderConfig(): CalldataDecoderConfig {
  return {
    etherscan: {
      enabled: process.env['ETHERSCAN_ENRICHMENT_ENABLED'] === 'true',
      apiKey: process.env['ETHERSCAN_API_KEY'] ?? null,
      baseUrl: process.env['ETHERSCAN_API_BASE_URL'] ?? DEFAULT_BASE_URL,
      supportedChainIds: DEFAULT_SUPPORTED_CHAIN_IDS,
    },
  };
}
