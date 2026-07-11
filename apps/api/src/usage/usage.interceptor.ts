import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import type { AuthenticatedRequest } from '@nest/auth';
import { endpointFamily, UsageStore } from './usage.store';

// Records one usage tick per authenticated request (any request that carries an API key), keyed by
// the key id + endpoint family. Best-effort: a usage-store hiccup must never fail the request.
@Injectable()
export class UsageInterceptor implements NestInterceptor {
  private readonly logger = new Logger(UsageInterceptor.name);

  constructor(private readonly usage: UsageStore) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest> & { route?: { path?: string }; path?: string }>();

    return next.handle().pipe(
      tap(() => {
        const apiKey = request.apiKey;
        if (apiKey === undefined) {
          return;
        }
        const family = endpointFamily(request.route?.path ?? request.path ?? '');
        this.usage.record(apiKey.id, family).catch((error: unknown) => {
          this.logger.warn(`Failed to record usage for key ${apiKey.id}: ${String(error)}`);
        });
      }),
    );
  }
}
