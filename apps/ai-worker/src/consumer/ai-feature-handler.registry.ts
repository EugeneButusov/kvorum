import { Injectable } from '@nestjs/common';
import type { AiFeatureHandler } from './ai-feature-handler';
import type { AiFeature } from '../queue/ai-queue-names';

@Injectable()
export class AiFeatureHandlerRegistry {
  private readonly handlers = new Map<AiFeature, AiFeatureHandler>();

  register(feature: AiFeature, handler: AiFeatureHandler): void {
    this.handlers.set(feature, handler);
  }

  get(feature: AiFeature): AiFeatureHandler | undefined {
    return this.handlers.get(feature);
  }
}
