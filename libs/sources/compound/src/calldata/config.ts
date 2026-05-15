export interface EtherscanConfig {
  enabled: boolean;
  apiKey: string | null;
  baseUrlByChainId: Record<string, string>;
}

export interface CalldataDecoderConfig {
  etherscan: EtherscanConfig;
}

const DEFAULT_BASE_URL_BY_CHAIN_ID: Record<string, string> = {
  '0x1': 'https://api.etherscan.io',
  '0x89': 'https://api.polygonscan.com',
  '0xa4b1': 'https://api.arbiscan.io',
};

export function readCalldataDecoderConfig(): CalldataDecoderConfig {
  return {
    etherscan: {
      enabled: process.env['ETHERSCAN_ENRICHMENT_ENABLED'] === 'true',
      apiKey: process.env['ETHERSCAN_API_KEY'] ?? null,
      baseUrlByChainId: DEFAULT_BASE_URL_BY_CHAIN_ID,
    },
  };
}
