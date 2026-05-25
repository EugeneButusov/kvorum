import { createHash } from 'node:crypto';
import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { EMPTY, Observable, of } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { CACHE_CONTROL_KEY, type CacheControlOptions } from './cache-control.decorator';
import { RESPONSE_NORMALIZER, type ResponseNormalizer } from './response-normalizer';

const ETAG_OVERRIDE_KEY = 'etag_override';

type EtagOverrideFn = (body: unknown) => string | undefined;

export const EtagOverride = (override: EtagOverrideFn): MethodDecorator & ClassDecorator =>
  SetMetadata(ETAG_OVERRIDE_KEY, override);

function isCacheableRequest(req: Request): boolean {
  return req.method === 'GET' || req.method === 'HEAD';
}

function is2xx(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}
function is3xx(statusCode: number): boolean {
  return statusCode >= 300 && statusCode < 400;
}

function base64UrlSha1(input: string): string {
  return createHash('sha1').update(input).digest('base64url');
}

function computeStrongEtag(body: unknown): string {
  return `\"${base64UrlSha1(JSON.stringify(body)).slice(0, 27)}\"`;
}

function serializeCacheControl(options: CacheControlOptions | undefined): string {
  if (!options) {
    return 'no-cache';
  }

  const directives = [`${options.visibility}`, `max-age=${options.maxAgeSecs}`];
  if (options.sMaxAgeSecs !== undefined) {
    directives.push(`s-maxage=${options.sMaxAgeSecs}`);
  }
  if (options.staleWhileRevalidateSecs !== undefined) {
    directives.push(`stale-while-revalidate=${options.staleWhileRevalidateSecs}`);
  }
  return directives.join(', ');
}

function parseIfNoneMatch(header: string | undefined): string[] {
  if (!header) {
    return [];
  }

  return header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      if (part === '*') {
        return '*';
      }
      return part.startsWith('W/') ? part.slice(2).trim() : part;
    });
}

function hasTokenMatch(ifNoneMatch: string | undefined, etag: string): boolean {
  const tokens = parseIfNoneMatch(ifNoneMatch);
  return tokens.some((token) => token === '*' || token === etag);
}

@Injectable()
export class EtagInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RESPONSE_NORMALIZER) private readonly normalizer: ResponseNormalizer,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    if (!isCacheableRequest(req)) {
      return next.handle();
    }

    const cacheControl = this.reflector.getAllAndOverride<CacheControlOptions | undefined>(
      CACHE_CONTROL_KEY,
      [context.getHandler(), context.getClass()],
    );

    return next.handle().pipe(
      mergeMap((body) => {
        if (cacheControl !== undefined) {
          res.setHeader(
            'Cache-Control',
            is3xx(res.statusCode) ? 'no-store' : serializeCacheControl(cacheControl),
          );
        }

        if (!is2xx(res.statusCode) || body === undefined || body === null) {
          return of(body);
        }

        const normalized = this.normalizer.normalize(body);

        const override = this.reflector.getAllAndOverride<EtagOverrideFn | undefined>(
          ETAG_OVERRIDE_KEY,
          [context.getHandler(), context.getClass()],
        );
        const etag = override?.(normalized) ?? computeStrongEtag(normalized);

        res.setHeader('ETag', etag);

        if (hasTokenMatch(req.header('if-none-match'), etag)) {
          res.status(304);
          res.end();
          return EMPTY;
        }

        return of(normalized);
      }),
    );
  }
}

export const etagTesting = {
  computeStrongEtag,
  parseIfNoneMatch,
  hasTokenMatch,
  serializeCacheControl,
};
