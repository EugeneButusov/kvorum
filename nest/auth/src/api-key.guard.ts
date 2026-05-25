import {
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
  type CanActivate,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  hashApiKey,
  parseBearerToken,
  pepperCandidates,
  verifyApiKey,
  type PepperSet,
} from '@libs/auth';
import { ApiKeyRepository } from '@libs/db';
import { apiMetrics } from './auth-metrics';
import type { AuthenticatedRequest, SafeApiKey } from './authenticated-request';
import { IS_PUBLIC_KEY } from './public.decorator';

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

type RejectionReason = 'missing' | 'malformed' | 'unknown' | 'hash_mismatch';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly repo: ApiKeyRepository,
    private readonly pepperSet: PepperSet,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;
    if (authHeader === undefined) {
      return this.reject('missing');
    }

    const parsed = parseBearerToken(authHeader);
    if (parsed === null) {
      return this.reject('malformed');
    }

    let matchedPepper: 'current' | 'previous' | undefined;
    let matchedHash: Buffer | undefined;
    let lookup = undefined;

    for (const candidate of pepperCandidates(this.pepperSet, parsed.key)) {
      lookup = await this.repo.findActiveByHash(candidate.hash);
      if (lookup !== undefined) {
        matchedPepper = candidate.pepper;
        matchedHash = candidate.hash;
        break;
      }
    }

    if (lookup === undefined || matchedPepper === undefined || matchedHash === undefined) {
      return this.reject('unknown');
    }

    const verified = verifyApiKey(
      matchedPepper === 'current' ? this.pepperSet.current : this.pepperSet.previous!,
      parsed.key,
      matchedHash,
    );
    if (!verified) {
      return this.reject('hash_mismatch');
    }

    request.user = lookup.user;
    request.apiKey = lookup.apiKey as SafeApiKey;
    apiMetrics.pepperMatch.add(1, { pepper: matchedPepper });

    if (matchedPepper === 'previous') {
      this.repo
        .rehashKey(lookup.apiKey.id, hashApiKey(this.pepperSet.current, parsed.key))
        .catch((error: unknown) => {
          this.logger.warn(
            `Failed to rehash API key ${lookup.apiKey.id}: ${this.describeError(error)}`,
          );
        });
    }

    this.repo.touchLastUsed(lookup.apiKey.id).catch((error: unknown) => {
      this.logger.warn(
        `Failed to touch last_used_at for API key ${lookup.apiKey.id}: ${this.describeError(error)}`,
      );
    });

    return true;
  }

  private reject(reason: RejectionReason): never {
    apiMetrics.authRejections.add(1, { reason });
    throw new UnauthorizedException();
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
