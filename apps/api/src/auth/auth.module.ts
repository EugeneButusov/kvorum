import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ApiKeyRepository } from '@libs/db';
import { DbModule } from '@nest/db';
import { ApiKeyGuard, AUTH_CONFIG } from './api-key.guard';
import { parseAuthConfigFromEnv } from './auth.config';

@Module({
  imports: [DbModule],
  providers: [
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
    {
      provide: APP_GUARD,
      useExisting: ApiKeyGuard,
    },
  ],
})
export class AuthModule {}
