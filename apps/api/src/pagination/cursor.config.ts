import { z } from 'zod';

export type CursorConfig = {
  secret: string;
};

const schema = z.object({
  CURSOR_SECRET: z
    .string()
    .trim()
    .min(1, 'CURSOR_SECRET is required for signed cursor validation.'),
});

let cachedConfig: CursorConfig | undefined;

export function parseCursorConfigFromEnv(env: NodeJS.ProcessEnv): CursorConfig {
  const parsed = schema.parse(env);
  return {
    secret: parsed.CURSOR_SECRET,
  };
}

export function getCursorConfig(): CursorConfig {
  cachedConfig ??= parseCursorConfigFromEnv(process.env);
  return cachedConfig;
}

export function resetCursorConfigForTests(): void {
  cachedConfig = undefined;
}
