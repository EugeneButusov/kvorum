import { Controller, Delete, HttpCode, Inject, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRepository } from '@libs/db';
import {
  clearSessionCookies,
  Public,
  SessionGuard,
  SessionStore,
  SESSION_CONFIG,
  type SessionConfig,
  type SessionRequest,
} from '@nest/auth';

// Account management (SPEC §6.14). Session-authenticated (cookie); @Public() to skip the global
// ApiKeyGuard, @UseGuards(SessionGuard) for cookie auth + CSRF. Internal dashboard surface, so
// @ApiExcludeController — it stays out of the public read-API contract.
@ApiExcludeController()
@Public()
@UseGuards(SessionGuard)
@Controller('v1/account')
export class AccountController {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionStore,
    @Inject(SESSION_CONFIG) private readonly config: SessionConfig,
  ) {}

  // Permanent, immediate deletion of the caller's own account (KNOWN-020): revoke keys (by deleting
  // them), remove the user record, invalidate every session. The recovery-email hash for
  // re-registration prevention lands with the email/password fast-follow (nothing consumes it yet).
  @Delete()
  @HttpCode(204)
  async deleteAccount(
    @Req() req: SessionRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const userId = req.session!.userId;
    await this.users.deleteAccount(userId);
    await this.sessions.destroyAllForUser(userId);
    clearSessionCookies(res, this.config);
  }
}
