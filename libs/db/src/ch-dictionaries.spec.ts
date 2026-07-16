import { describe, expect, it } from 'vitest';
import { actorAddressRedirectDdl, pgSourceFromEnv } from './ch-dictionaries';

describe('pgSourceFromEnv', () => {
  it('defaults to the compose topology so local dev and CI are unchanged', () => {
    // ClickHouse reaches PG at the compose service name — NOT the app's DATABASE_URL host, which is
    // localhost locally and would point ClickHouse at itself. The defaults match migration 0006.
    expect(pgSourceFromEnv({})).toEqual({
      host: 'postgres',
      port: 5432,
      user: 'kvorum',
      password: 'kvorum',
      db: 'kvorum',
    });
  });

  it('takes the production route from env', () => {
    expect(
      pgSourceFromEnv({
        CH_DICT_PG_HOST: 'db.example.com',
        CH_DICT_PG_PORT: '25060',
        CH_DICT_PG_USER: 'reader',
        CH_DICT_PG_PASSWORD: 's3cret',
        CH_DICT_PG_DB: 'kvorum_prod',
      }),
    ).toEqual({
      host: 'db.example.com',
      port: 25060,
      user: 'reader',
      password: 's3cret',
      db: 'kvorum_prod',
    });
  });

  it('rejects a non-numeric port rather than silently sending NaN', () => {
    expect(() => pgSourceFromEnv({ CH_DICT_PG_PORT: 'not-a-port' })).toThrow(/positive integer/);
  });
});

describe('actorAddressRedirectDdl', () => {
  const base = { host: 'h', port: 5432, user: 'u', password: 'p', db: 'd' };

  it('is a CREATE OR REPLACE so an operator can safely re-run it', () => {
    expect(actorAddressRedirectDdl(base)).toContain(
      'CREATE OR REPLACE DICTIONARY actor_address_redirect',
    );
  });

  it('embeds the configured connection', () => {
    const ddl = actorAddressRedirectDdl({
      host: 'db.example.com',
      port: 25060,
      user: 'reader',
      password: 'pw',
      db: 'kvorum_prod',
    });
    expect(ddl).toContain("HOST 'db.example.com'");
    expect(ddl).toContain('PORT 25060');
    expect(ddl).toContain("USER 'reader'");
    expect(ddl).toContain("DB 'kvorum_prod'");
  });

  it('escapes quotes in credentials instead of breaking out of the literal', () => {
    const ddl = actorAddressRedirectDdl({ ...base, password: "pa'ss\\word" });
    expect(ddl).toContain("PASSWORD 'pa\\'ss\\\\word'");
  });

  it('keeps the redirect union semantics (a redirect only applies when unshadowed)', () => {
    const ddl = actorAddressRedirectDdl(base);
    expect(ddl).toContain('FROM actor_address aa');
    expect(ddl).toContain('FROM actor_address_redirect r');
    expect(ddl).toContain('WHERE NOT EXISTS');
  });
});
