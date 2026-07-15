import createClient from 'openapi-fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';

vi.mock('openapi-fetch', () => ({ default: vi.fn(() => ({})) }));

describe('createApiClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attaches the internal read token as x-internal-read-token (direct SSR calls bypass the BFF)', () => {
    createApiClient({ baseUrl: 'http://api', internalReadToken: 'secret' });
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'x-internal-read-token': 'secret' } }),
    );
  });

  it('attaches an api key as a Bearer Authorization header', () => {
    createApiClient({ baseUrl: 'http://api', apiKey: 'kv_live_x' });
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { Authorization: 'Bearer kv_live_x' } }),
    );
  });

  it('sends no auth headers when neither is provided', () => {
    createApiClient({ baseUrl: 'http://api' });
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ headers: undefined }));
  });
});
