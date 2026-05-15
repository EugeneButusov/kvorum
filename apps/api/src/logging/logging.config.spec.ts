import { describe, expect, it, vi } from 'vitest';
import {
  createLoggingParams,
  generateRequestId,
  resolveRequestIdFromHeader,
} from './logging.config';

describe('resolveRequestIdFromHeader', () => {
  it('accepts valid header values', () => {
    expect(resolveRequestIdFromHeader({ 'x-request-id': 'abc-123_X.y' })).toBe('abc-123_X.y');
  });

  it('rejects invalid values', () => {
    expect(resolveRequestIdFromHeader({ 'x-request-id': 'bad val!!' })).toBeUndefined();
    expect(resolveRequestIdFromHeader({ 'x-request-id': '' })).toBeUndefined();
  });
});

describe('generateRequestId', () => {
  it('echoes valid inbound request id', () => {
    const setHeader = vi.fn();
    const req = { headers: { 'x-request-id': 'req_42' } } as never;
    const res = { setHeader } as never;

    const requestId = generateRequestId(req, res);

    expect(requestId).toBe('req_42');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'req_42');
  });

  it('regenerates when inbound header is invalid', () => {
    const setHeader = vi.fn();
    const req = { headers: { 'x-request-id': 'invalid header' } } as never;
    const res = { setHeader } as never;

    const requestId = generateRequestId(req, res);

    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', requestId);
  });
});

describe('createLoggingParams', () => {
  it('maps required log fields', () => {
    const params = createLoggingParams('api');
    const pinoHttp = params.pinoHttp as NonNullable<typeof params.pinoHttp>;

    expect(pinoHttp).toMatchObject({
      messageKey: 'message',
      timestamp: false,
      customAttributeKeys: { reqId: 'request_id' },
    });

    const levelFormatter = pinoHttp.formatters?.level?.('info');
    const logFormatter = pinoHttp.formatters?.log?.({ message: 'hello' });
    const props = pinoHttp.customProps?.({ id: 'req-1' } as never, {} as never);

    expect(levelFormatter).toEqual({ level: 'info' });
    expect(logFormatter).toEqual(expect.objectContaining({ message: 'hello' }));
    expect(logFormatter?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(props).toEqual({ service: 'api', request_id: 'req-1' });
  });
});
