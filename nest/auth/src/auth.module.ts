import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import type Redis from 'ioredis';
import { ApiKeyRepository, UserRepository, pgDb } from '@libs/db';
import { ApiKeyGuard, AUTH_CONFIG } from './api-key.guard';
import { parseAuthConfigFromEnv } from './auth.config';
import { createSessionRedis, SESSION_REDIS } from './session/session-redis.client';
import { parseSessionConfigFromEnv, type SessionConfig } from './session/session.config';
import { SessionGuard } from './session/session.guard';
import { SessionStore } from './session/session.store';
import { NonceStore } from './siwe/nonce.store';
import { SiweAuthService } from './siwe/siwe-auth.service';
import { parseSiweConfigFromEnv, type SiweConfig } from './siwe/siwe.config';

export const SESSION_CONFIG = Symbol('SESSION_CONFIG');
export const SIWE_CONFIG = Symbol('SIWE_CONFIG');

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
    // One Redis connection shared by the session store and the SIWE nonce store.
    {
      provide: SESSION_REDIS,
      useFactory: (config: SessionConfig) => createSessionRedis(config.redisUrl),
      inject: [SESSION_CONFIG],
    },
    {
      provide: SessionStore,
      useFactory: (redis: Redis) => new SessionStore(redis),
      inject: [SESSION_REDIS],
    },
    {
      provide: SessionGuard,
      useFactory: (store: SessionStore, users: UserRepository) => new SessionGuard(store, users),
      inject: [SessionStore, UserRepository],
    },
    // ── SIWE (wallet) auth ──
    { provide: SIWE_CONFIG, useFactory: () => parseSiweConfigFromEnv(process.env) },
    {
      provide: NonceStore,
      useFactory: (redis: Redis) => new NonceStore(redis),
      inject: [SESSION_REDIS],
    },
    {
      provide: SiweAuthService,
      useFactory: (config: SiweConfig, nonces: NonceStore) => new SiweAuthService(config, nonces),
      inject: [SIWE_CONFIG, NonceStore],
    },
  ],
  // UserRepository is exported because @UseGuards(SessionGuard) re-resolves the guard's constructor
  // deps in the host module's injector, so they must be visible there.
  exports: [
    ApiKeyGuard,
    AUTH_CONFIG,
    ApiKeyRepository,
    SessionGuard,
    SessionStore,
    SESSION_CONFIG,
    UserRepository,
    NonceStore,
    SiweAuthService,
  ],
})
export class AuthModule {}
