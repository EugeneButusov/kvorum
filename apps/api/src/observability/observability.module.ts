import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsInterceptor } from './metrics.interceptor';

@Module({
  providers: [
    MetricsInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useExisting: MetricsInterceptor,
    },
  ],
})
export class ObservabilityModule {}
