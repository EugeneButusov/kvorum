import { Controller, Get, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  clearSessionCookies,
  Public,
  SessionGuard,
  SessionStore,
  SESSION_CONFIG,
  type SessionConfig,
  type SessionRequest,
} from '@nest/auth';

// TEMPORARY (M6-2.1): a throwaway surface that exercises SessionGuard + CSRF + sign-out end-to-end
// over real HTTP, so the session substrate has deterministic e2e coverage before SIWE exists. There
// is deliberately NO unauthenticated login route here — e2e seeds a session via SessionStore
// in-process. The real SIWE auth controller replaces this in M6-2.2; delete this file then.
//
// @ApiExcludeController keeps these throwaway routes out of the committed OpenAPI contract — the
// real auth/keys surface is documented + regenerated in M6-2.4.
@ApiExcludeController()
@Controller('v1/_session')
export class SessionProbeController {
  constructor(
    private readonly store: SessionStore,
    @Inject(SESSION_CONFIG) private readonly config: SessionConfig,
  ) {}

  // @Public() lifts the global ApiKeyGuard; SessionGuard then authenticates via the cookie.
  @Public()
  @UseGuards(SessionGuard)
  @Get('me')
  me(@Req() req: SessionRequest): { userId: string; sessionId: string } {
    return { userId: req.session!.userId, sessionId: req.session!.id };
  }

  @Public()
  @UseGuards(SessionGuard)
  @Post('logout')
  async logout(
    @Req() req: SessionRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.store.destroy(req.session!.id);
    clearSessionCookies(res, this.config);
    return { ok: true };
  }

  @Public()
  @UseGuards(SessionGuard)
  @Post('logout-all')
  async logoutAll(
    @Req() req: SessionRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.store.destroyAllForUser(req.session!.userId);
    clearSessionCookies(res, this.config);
    return { ok: true };
  }
}
