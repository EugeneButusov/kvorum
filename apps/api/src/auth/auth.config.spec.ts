import { parseAuthConfigFromEnv } from './auth.config';

function validPepper(char: string): string {
  return Buffer.alloc(32, char).toString('base64');
}

describe('parseAuthConfigFromEnv', () => {
  it('throws when HMAC_PEPPER_CURRENT is missing', () => {
    expect(() => parseAuthConfigFromEnv({})).toThrow();
  });

  it('throws when HMAC_PEPPER_CURRENT is not base64', () => {
    expect(() => parseAuthConfigFromEnv({ HMAC_PEPPER_CURRENT: 'not-base64' })).toThrow();
  });

  it('throws when HMAC_PEPPER_CURRENT decodes to wrong length', () => {
    const short = Buffer.alloc(16, 1).toString('base64');
    expect(() => parseAuthConfigFromEnv({ HMAC_PEPPER_CURRENT: short })).toThrow();
  });

  it('parses current pepper as 32-byte buffer', () => {
    const result = parseAuthConfigFromEnv({ HMAC_PEPPER_CURRENT: validPepper('a') });
    expect(result.current).toBeInstanceOf(Buffer);
    expect(result.current).toHaveLength(32);
    expect(result.previous).toBeUndefined();
  });

  it('throws when HMAC_PEPPER_PREVIOUS is malformed', () => {
    expect(() =>
      parseAuthConfigFromEnv({
        HMAC_PEPPER_CURRENT: validPepper('a'),
        HMAC_PEPPER_PREVIOUS: 'bad',
      }),
    ).toThrow();
  });
});
