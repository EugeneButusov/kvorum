import {
  clearSessionCookies,
  setSessionCookies,
  type CookieOptions,
  type CookieWriter,
} from './cookies';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type SessionConfig,
} from './session.config';

type SetCall = { name: string; value: string; options: CookieOptions };
type ClearCall = { name: string; options: CookieOptions | undefined };

function makeWriter(): { writer: CookieWriter; sets: SetCall[]; clears: ClearCall[] } {
  const sets: SetCall[] = [];
  const clears: ClearCall[] = [];
  const writer: CookieWriter = {
    cookie: (name, value, options) => sets.push({ name, value, options }),
    clearCookie: (name, options) => clears.push({ name, options }),
  };
  return { writer, sets, clears };
}

const CONFIG: SessionConfig = {
  redisUrl: 'redis://x',
  cookieSecure: true,
  cookieDomain: undefined,
};

describe('session cookies', () => {
  it('sets an HttpOnly session cookie and a JS-readable CSRF cookie, both Secure + SameSite=Strict', () => {
    const { writer, sets } = makeWriter();
    setSessionCookies(writer, { sessionId: 'sid', csrfToken: 'csrf' }, CONFIG);

    const session = sets.find((c) => c.name === SESSION_COOKIE);
    const csrf = sets.find((c) => c.name === CSRF_COOKIE);

    expect(session).toBeDefined();
    expect(session!.value).toBe('sid');
    expect(session!.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_TTL_SECONDS * 1000,
    });

    // The CSRF cookie MUST be readable by JS for the double-submit echo.
    expect(csrf).toBeDefined();
    expect(csrf!.value).toBe('csrf');
    expect(csrf!.options.httpOnly).toBe(false);
    expect(csrf!.options).toMatchObject({ secure: true, sameSite: 'strict' });
  });

  it('omits the domain when unset and includes it when configured', () => {
    const { writer: w1, sets: s1 } = makeWriter();
    setSessionCookies(w1, { sessionId: 'sid', csrfToken: 'csrf' }, CONFIG);
    expect(s1[0]!.options.domain).toBeUndefined();

    const { writer: w2, sets: s2 } = makeWriter();
    setSessionCookies(
      w2,
      { sessionId: 'sid', csrfToken: 'csrf' },
      { ...CONFIG, cookieDomain: '.kvorum.watch' },
    );
    expect(s2[0]!.options.domain).toBe('.kvorum.watch');
  });

  it('honours an insecure-cookie override for local dev', () => {
    const { writer, sets } = makeWriter();
    setSessionCookies(
      writer,
      { sessionId: 'sid', csrfToken: 'csrf' },
      { ...CONFIG, cookieSecure: false },
    );
    expect(sets.every((c) => c.options.secure === false)).toBe(true);
  });

  it('clears both cookies', () => {
    const { writer, clears } = makeWriter();
    clearSessionCookies(writer, CONFIG);
    expect(clears.map((c) => c.name).sort()).toEqual([CSRF_COOKIE, SESSION_COOKIE].sort());
  });
});
