import { decodePepper, type PepperSet } from './pepper';

export function parsePepperSetFromEnv(env: NodeJS.ProcessEnv): PepperSet {
  const currentRaw = env['HMAC_PEPPER_CURRENT'];
  if (currentRaw == null || currentRaw.length === 0) {
    throw new Error('HMAC_PEPPER_CURRENT must be set');
  }

  const previousRaw = env['HMAC_PEPPER_PREVIOUS'];
  return {
    current: decodePepper(currentRaw),
    previous:
      previousRaw == null || previousRaw.length === 0 ? undefined : decodePepper(previousRaw),
  };
}
