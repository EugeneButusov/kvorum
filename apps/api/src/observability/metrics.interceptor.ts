import { CallHandler, ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { apiMetrics } from './api-metrics';

type RequestLike = {
  method?: string;
  baseUrl?: string;
  route?: { path?: string };
};

type ResponseLike = {
  statusCode?: number;
};

function normalizeRoutePart(part: string): string {
  if (!part) {
    return '';
  }
  return part.startsWith('/') ? part : `/${part}`;
}

export function deriveRouteLabel(req: RequestLike): string {
  const routePath = req.route?.path;
  if (!routePath) {
    return 'unknown';
  }

  const base = normalizeRoutePart(req.baseUrl ?? '');
  const path = normalizeRoutePart(routePath);
  return `${base}${path}` || '/';
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<RequestLike>();
    const res = http.getResponse<ResponseLike>();

    const method = req.method ?? 'UNKNOWN';
    const route = deriveRouteLabel(req);
    const startedAt = process.hrtime.bigint();

    return next.handle().pipe(
      finalize(() => {
        const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
        const status = String(res.statusCode ?? 500);

        apiMetrics.requests.add(1, { method, route, status });
        apiMetrics.latencySeconds.record(elapsedSeconds, { method, route, status });
      }),
    );
  }
}
