import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRepository } from '@libs/db';
import {
  clearSessionCookies,
  NonceStore,
  Public,
  SessionGuard,
  SessionStore,
  SESSION_CONFIG,
  SiweAuthService,
  setSessionCookies,
  type SessionConfig,
  type SessionRequest,
} from '@nest/auth';
import { SiweVerifyDto } from './siwe.dto';
import { AuthIpRateLimitGuard } from '../rate-limit/auth-ip-rate-limit.guard';

// Dashboard auth surface (SPEC §6.14). All routes are @Public() (no API key); the SIWE endpoints
// are per-IP rate-limited, the session/logout endpoints are cookie-authenticated via SessionGuard.
// @ApiExcludeController for now — the unified auth+keys OpenAPI regen is M6-2.4.
@ApiExcludeController()
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly siwe: SiweAuthService,
    private readonly nonces: NonceStore,
    private readonly users: UserRepository,
    private readonly sessions: SessionStore,
    @Inject(SESSION_CONFIG) private readonly config: SessionConfig,
  ) {}

  // ── SIWE (wallet) login ──

  @Public()
  @UseGuards(AuthIpRateLimitGuard)
  @Post('siwe/nonce')
  async nonce(): Promise<{ nonce: string }> {
    return { nonce: await this.nonces.issue() };
  }

  @Public()
  @UseGuards(AuthIpRateLimitGuard)
  @Post('siwe/verify')
  async verify(
    @Body() body: SiweVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ userId: string; address: string }> {
    const result = await this.siwe.verify({ message: body.message, signature: body.signature });
    if (!result.ok) {
      if (result.reason === 'malformed') {
        throw new BadRequestException('Malformed SIWE message');
      }
      throw new UnauthorizedException('SIWE verification failed');
    }

    const user = await this.users.upsertByWalletAddress({ walletAddress: result.address });

    if (body.email !== undefined) {
      const outcome = await this.users.setRecoveryEmail(user.id, body.email);
      if (outcome === 'conflict') {
        throw new ConflictException('Email is already associated with another account');
      }
    }

    const { id, csrfToken } = await this.sessions.create(user.id);
    setSessionCookies(res, { sessionId: id, csrfToken }, this.config);
    return { userId: user.id, address: result.address };
  }

  // ── Session ──

  @Public()
  @UseGuards(SessionGuard)
  @Get('session')
  session(@Req() req: SessionRequest): { userId: string; address: string | null } {
    return { userId: req.session!.userId, address: req.user!.wallet_address };
  }

  @Public()
  @UseGuards(SessionGuard)
  @Post('logout')
  async logout(
    @Req() req: SessionRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.sessions.destroy(req.session!.id);
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
    await this.sessions.destroyAllForUser(req.session!.userId);
    clearSessionCookies(res, this.config);
    return { ok: true };
  }
}
