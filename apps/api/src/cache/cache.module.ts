import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { EtagInterceptor } from './etag.interceptor';
import {
  IdentityResponseNormalizer,
  RESPONSE_NORMALIZER,
  type ResponseNormalizer,
} from './response-normalizer';

@Module({
  providers: [
    {
      provide: RESPONSE_NORMALIZER,
      useClass: IdentityResponseNormalizer,
    },
    {
      provide: EtagInterceptor,
      useFactory: (reflector: Reflector, normalizer: ResponseNormalizer) =>
        new EtagInterceptor(reflector, normalizer),
      inject: [Reflector, RESPONSE_NORMALIZER],
    },
    {
      provide: APP_INTERCEPTOR,
      useExisting: EtagInterceptor,
    },
  ],
})
export class CacheModule {}
