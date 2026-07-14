import { makeQueryClient } from './query-client';
import { ApiError } from './session';
import { SESSION_QUERY_KEY } from '../auth/session-key';

describe('makeQueryClient session-expiry handling', () => {
  it('clears the cached session when a query fails with 401', async () => {
    const client = makeQueryClient();
    client.setQueryData(SESSION_QUERY_KEY, { userId: 'u1', address: '0xabc' });

    await client
      .fetchQuery({
        queryKey: ['keys'],
        queryFn: async () => {
          throw new ApiError(401, 'Unauthorized');
        },
        retry: false,
      })
      .catch(() => undefined);

    expect(client.getQueryData(SESSION_QUERY_KEY)).toBeNull();
  });

  it('leaves the session untouched for non-401 failures', async () => {
    const client = makeQueryClient();
    const session = { userId: 'u1', address: '0xabc' };
    client.setQueryData(SESSION_QUERY_KEY, session);

    await client
      .fetchQuery({
        queryKey: ['keys'],
        queryFn: async () => {
          throw new ApiError(500, 'Server error');
        },
        retry: false,
      })
      .catch(() => undefined);

    expect(client.getQueryData(SESSION_QUERY_KEY)).toEqual(session);
  });
});
