import { describe, expect, it } from 'vitest';
import { AllProvidersFailedError } from './all-providers-failed.error.js';
import { ChainConfigError } from './chain-config.error.js';
import { ClientStoppedError } from './client-stopped.error.js';
import { categorizeError, scrubError } from './errors.js';
import { NotImplementedError } from './not-implemented.error.js';

function ethersError(code: string, extra: Record<string, unknown> = {}): unknown {
  return { code, ...extra };
}

describe('categorizeError', () => {
  it('TIMEOUT → timeout', () => {
    expect(categorizeError(ethersError('TIMEOUT'))).toBe('timeout');
  });

  it('ECONNREFUSED → network_error', () => {
    expect(categorizeError(ethersError('ECONNREFUSED'))).toBe('network_error');
  });

  it('NETWORK_ERROR → network_error', () => {
    expect(categorizeError(ethersError('NETWORK_ERROR'))).toBe('network_error');
  });

  it('SERVER_ERROR 5xx → http_5xx', () => {
    const err = ethersError('SERVER_ERROR', { response: { statusCode: 503 } });
    expect(categorizeError(err)).toBe('http_5xx');
  });

  it('SERVER_ERROR 500 → http_5xx', () => {
    const err = ethersError('SERVER_ERROR', { response: { statusCode: 500 } });
    expect(categorizeError(err)).toBe('http_5xx');
  });

  it('SERVER_ERROR without matching status → unknown', () => {
    const err = ethersError('SERVER_ERROR', { response: { statusCode: 400 } });
    expect(categorizeError(err)).toBe('unknown');
  });

  it('SERVER_ERROR without response → unknown', () => {
    expect(categorizeError(ethersError('SERVER_ERROR'))).toBe('unknown');
  });

  it('UNSUPPORTED_OPERATION (bad JSON body) → unknown', () => {
    expect(categorizeError(ethersError('UNSUPPORTED_OPERATION'))).toBe('unknown');
  });

  it('UNKNOWN_ERROR with JSON-RPC inner code → transparent', () => {
    const err = ethersError('UNKNOWN_ERROR', { error: { code: -32601 } });
    expect(categorizeError(err)).toBe('transparent');
  });

  it('UNKNOWN_ERROR with -32602 → transparent', () => {
    const err = ethersError('UNKNOWN_ERROR', { error: { code: -32602 } });
    expect(categorizeError(err)).toBe('transparent');
  });

  it('UNKNOWN_ERROR without inner code → unknown', () => {
    expect(categorizeError(ethersError('UNKNOWN_ERROR'))).toBe('unknown');
  });

  it('CALL_EXCEPTION → transparent', () => {
    expect(categorizeError(ethersError('CALL_EXCEPTION'))).toBe('transparent');
  });

  it('INVALID_ARGUMENT → transparent', () => {
    expect(categorizeError(ethersError('INVALID_ARGUMENT'))).toBe('transparent');
  });

  it('MISSING_ARGUMENT → transparent', () => {
    expect(categorizeError(ethersError('MISSING_ARGUMENT'))).toBe('transparent');
  });

  it('NOT_IMPLEMENTED → transparent', () => {
    expect(categorizeError(ethersError('NOT_IMPLEMENTED'))).toBe('transparent');
  });

  it('null → unknown', () => {
    expect(categorizeError(null)).toBe('unknown');
  });

  it('string → unknown', () => {
    expect(categorizeError('oops')).toBe('unknown');
  });

  it('unknown code → unknown', () => {
    expect(categorizeError(ethersError('SOME_FUTURE_CODE'))).toBe('unknown');
  });
});

describe('scrubError', () => {
  it('removes the request field', () => {
    const err = {
      code: 'TIMEOUT',
      request: { url: 'https://secret.alchemy.io/v2/KEY' },
      message: 'timeout',
    };
    const scrubbed = scrubError(err) as Record<string, unknown>;
    expect(scrubbed['request']).toBeUndefined();
    expect(scrubbed['code']).toBe('TIMEOUT');
    expect(scrubbed['message']).toBe('timeout');
  });

  it('redacts url fields', () => {
    const err = { code: 'NETWORK_ERROR', url: 'https://secret.alchemy.io/v2/KEY' };
    const scrubbed = scrubError(err) as Record<string, unknown>;
    expect(scrubbed['url']).toBe('[redacted]');
  });

  it('passes through non-object values', () => {
    expect(scrubError('a string')).toBe('a string');
    expect(scrubError(42)).toBe(42);
    expect(scrubError(null)).toBeNull();
  });

  it('does not mutate the original error', () => {
    const err = { code: 'TIMEOUT', request: { url: 'https://secret' } };
    scrubError(err);
    expect(err.request).toBeDefined();
  });
});

describe('error classes', () => {
  it('AllProvidersFailedError carries chainId and attempts', () => {
    const err = new AllProvidersFailedError(1, [
      { provider: 'p1', reason: 'timeout', cause: null },
    ]);
    expect(err.chainId).toBe(1);
    expect(err.attempts).toHaveLength(1);
    expect(err.name).toBe('AllProvidersFailedError');
    expect(err).toBeInstanceOf(Error);
  });

  it('ChainConfigError is an Error', () => {
    const err = new ChainConfigError('bad');
    expect(err.name).toBe('ChainConfigError');
    expect(err).toBeInstanceOf(Error);
  });

  it('ClientStoppedError carries chainId', () => {
    const err = new ClientStoppedError(1);
    expect(err.chainId).toBe(1);
    expect(err.name).toBe('ClientStoppedError');
  });

  it('NotImplementedError is an Error', () => {
    const err = new NotImplementedError('ws not implemented');
    expect(err.name).toBe('NotImplementedError');
  });
});
