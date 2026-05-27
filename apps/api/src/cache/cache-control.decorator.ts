import { SetMetadata } from '@nestjs/common';

export const CACHE_CONTROL_KEY = 'cache_control';

export type CacheControlOptions = {
  visibility: 'public' | 'private';
  maxAgeSecs: number;
  mustRevalidate?: boolean;
  sMaxAgeSecs?: number;
  staleWhileRevalidateSecs?: number;
};

export const CacheControl = (options: CacheControlOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(CACHE_CONTROL_KEY, options);
