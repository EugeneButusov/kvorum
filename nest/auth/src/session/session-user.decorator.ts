import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { User } from '@libs/db';
import type { SessionRequest } from './session-request';

// Resolves to the User attached by SessionGuard. Only valid on handlers guarded by SessionGuard.
export const SessionUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    if (request.user === undefined) {
      throw new Error('SessionUser used on a route without SessionGuard');
    }
    return request.user;
  },
);
