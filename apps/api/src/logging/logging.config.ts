import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_REGEX = /^[A-Za-z0-9._-]{1,128}$/;

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}

export function resolveRequestIdFromHeader(
  headers: IncomingMessage['headers'],
): string | undefined {
  const candidate = normalizeHeaderValue(headers[REQUEST_ID_HEADER]);
  if (!candidate) {
    return undefined;
  }
  if (!REQUEST_ID_REGEX.test(candidate)) {
    return undefined;
  }
  return candidate;
}

export function generateRequestId(req: IncomingMessage, res: ServerResponse): string {
  const requestId = resolveRequestIdFromHeader(req.headers) ?? randomUUID();
  res.setHeader('X-Request-Id', requestId);
  return requestId;
}

export function createLoggingParams(service = process.env['OTEL_SERVICE_NAME'] ?? 'api'): Params {
  return {
    pinoHttp: {
      messageKey: 'message',
      timestamp: false,
      autoLogging: true,
      customAttributeKeys: {
        reqId: 'request_id',
      },
      genReqId: generateRequestId,
      customProps: (req) => ({
        service,
        request_id: String(req.id),
      }),
      formatters: {
        level: (label) => ({ level: label }),
        log: (object) => ({ timestamp: new Date().toISOString(), ...object }),
      },
      redact: {
        paths: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers.x-api-key'],
        censor: '[REDACTED]',
      },
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    },
  };
}
