// AAVE governance token (proxy) on Ethereum mainnet (0x7Fc66500...DDaE9).
// Lowercase per existing dao.primary_token_address storage for the same token.
// gitleaks:allow -- public Ethereum contract address, not a credential.
export const AAVE_TOKEN_ADDRESS = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9';

// The AaveTokenV3 implementation (0x5D4Aa78B...) was activated on the proxy at this
// block (2023-12-26), coinciding with the Aave Governance V3 activation. V3 is the only
// implementation that emits DelegateChanged(delegator, delegatee, GovernancePowerType);
// pre-V3 (AaveTokenV2 ABI: DelegationType + DelegatedPowerChanged) delegation history is
// out of scope for the lean cut (ADR-0070). The operator verifies the exact `Upgraded`
// transaction block against the deployed proxy at registration time.
export const AAVE_TOKEN_V3_ACTIVATION_BLOCK = 18870593;
