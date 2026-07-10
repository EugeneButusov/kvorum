import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ApiKeyRepository, UserRepository, pgDb } from '@libs/db';
import { ApiKeyGuard, AUTH_CONFIG } from './api-key.guard';
import { parseAuthConfigFromEnv } from './auth.config';
import { createSessionRedis } from './session/session-redis.client';
import { parseSessionConfigFromEnv, type SessionConfig } from './session/session.config';
import { SessionGuard } from './session/session.guard';
import { SessionStore } from './session/session.store';

export const SESSION_CONFIG = Symbol('SESSION_CONFIG');

@Module({
  providers: [
    { provide: ApiKeyRepository, useFactory: () => new ApiKeyRepository(pgDb) },
    { provide: UserRepository, useFactory: () => new UserRepository(pgDb) },
    {
      provide: AUTH_CONFIG,
      useFactory: () => parseAuthConfigFromEnv(process.env),
    },
    {
      provide: ApiKeyGuard,
      useFactory: (
        reflector: Reflector,
        repo: ApiKeyRepository,
        authConfig: ReturnType<typeof parseAuthConfigFromEnv>,
      ) => new ApiKeyGuard(reflector, repo, authConfig),
      inject: [Reflector, ApiKeyRepository, AUTH_CONFIG],
    },
    { provide: APP_GUARD, useExisting: ApiKeyGuard },
    // ── Session (cookie) auth — independent of the global ApiKeyGuard ──
    { provide: SESSION_CONFIG, useFactory: () => parseSessionConfigFromEnv(process.env) },
    {
      provide: SessionStore,
      useFactory: (config: SessionConfig) => new SessionStore(createSessionRedis(config.redisUrl)),
      inject: [SESSION_CONFIG],
    },
    {
      provide: SessionGuard,
      useFactory: (store: SessionStore, users: UserRepository) => new SessionGuard(store, users),
      inject: [SessionStore, UserRepository],
    },
  ],
  // UserRepository is exported because @UseGuards(SessionGuard) re-resolves the guard's constructor
  // deps in the host module's injector, so they must be visible there.
  exports: [ApiKeyGuard, SessionGuard, SessionStore, SESSION_CONFIG, UserRepository],
})
export class AuthModule {}
