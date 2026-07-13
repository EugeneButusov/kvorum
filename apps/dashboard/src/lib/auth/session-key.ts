// The session query key, in its own dependency-free module so both the session hooks and the query
// client (which clears it on a 401) can import it without pulling in the wallet stack.
export const SESSION_QUERY_KEY = ['auth', 'session'] as const;
