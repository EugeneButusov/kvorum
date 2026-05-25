import { parsePepperSetFromEnv, type PepperSet } from '@libs/auth';

export function parseAuthConfigFromEnv(env: NodeJS.ProcessEnv): PepperSet {
  return parsePepperSetFromEnv(env);
}
