import type { EligibleVpProvider } from '@sources/core';

export async function loadEligibleVpProviders(): Promise<readonly EligibleVpProvider[]> {
  const [compound, aave, lido] = await Promise.all([
    import('@sources/compound'),
    import('@sources/aave'),
    import('@sources/lido'),
  ]);
  return [
    compound.compoundEligibleVpProvider,
    aave.aaveV2EligibleVpProvider,
    aave.aaveV3EligibleVpProvider,
    lido.aragonEligibleVpProvider,
  ];
}

export function buildVpFetcherMap(
  providers: readonly EligibleVpProvider[],
): Map<string, EligibleVpProvider> {
  const map = new Map<string, EligibleVpProvider>();
  for (const provider of providers) {
    for (const sourceType of provider.sourceTypes) {
      map.set(sourceType, provider);
    }
  }
  return map;
}
