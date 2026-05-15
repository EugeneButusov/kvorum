import { ZodError } from 'zod';
import {
  parseCursorConfigFromEnv,
  resetCursorConfigForTests,
  getCursorConfig,
} from './cursor.config';

describe('cursor config', () => {
  beforeEach(() => {
    delete process.env['CURSOR_SECRET'];
    resetCursorConfigForTests();
  });

  it('fails when CURSOR_SECRET is missing', () => {
    expect(() => parseCursorConfigFromEnv({})).toThrow(ZodError);
  });

  it('loads CURSOR_SECRET when present', () => {
    const config = parseCursorConfigFromEnv({ CURSOR_SECRET: 'secret' });
    expect(config.secret).toBe('secret');
  });

  it('caches config for repeated access', () => {
    process.env['CURSOR_SECRET'] = 'a';
    const first = getCursorConfig();
    process.env['CURSOR_SECRET'] = 'b';
    const second = getCursorConfig();
    expect(first.secret).toBe('a');
    expect(second.secret).toBe('a');
  });
});
