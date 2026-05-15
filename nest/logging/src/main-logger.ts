import type { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

export function usePinoNestLogger(app: INestApplication): void {
  app.useLogger(app.get(Logger));
}
