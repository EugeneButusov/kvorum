import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { UserRepository } from '@libs/db';
import type { SessionContext, SessionRequest } from './session-request';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from './session.config';
import { SessionStore, SessionStoreUnavailableError } from './session.store';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Authenticates cookie-based (dashboard) requests. Independent of ApiKeyGuard: session routes opt
// out of the global key guard with @Public() and opt into this one with @UseGuards(SessionGuard).
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly logger = new Logger(SessionGuard.name);

  constructor(
    private readonly store: SessionStore,
    private readonly users: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest>();

    const sessionId = request.cookies[SESSION_COOKIE];
    if (sessionId === undefined || sessionId === '') {
      throw new UnauthorizedException();
    }

    const record = await this.load(sessionId);
    if (record === null) {
      throw new UnauthorizedException();
    }

    if (MUTATING_METHODS.has(request.method.toUpperCase())) {
      this.assertCsrf(request, record.csrfToken);
    }

    const user = await this.users.findById(record.userId);
    if (user === undefined || user.banned_at !== null) {
      throw new UnauthorizedException();
    }

    const session: SessionContext = { ...record, id: sessionId };
    request.user = user;
    request.session = session;

    // Sliding extension is best-effort — a transient store hiccup here must not fail an already
    // authenticated request.
    this.store.touch(sessionId, record).catch((error: unknown) => {
      this.logger.warn(`Failed to touch session ${sessionId}: ${describeError(error)}`);
    });

    return true;
  }

  private async load(sessionId: string) {
    try {
      return await this.store.get(sessionId);
    } catch (error) {
      if (error instanceof SessionStoreUnavailableError) {
        // Outage must not read as "logged out".
        throw new ServiceUnavailableException('Session store is unavailable');
      }
      throw error;
    }
  }

  private assertCsrf(request: SessionRequest, expected: string): void {
    const headerToken = request.headers[CSRF_HEADER];
    const cookieToken = request.cookies[CSRF_COOKIE];
    if (
      headerToken === undefined ||
      cookieToken === undefined ||
      headerToken !== cookieToken ||
      headerToken !== expected
    ) {
      throw new ForbiddenException('CSRF token missing or invalid');
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
