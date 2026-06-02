import { Logger as NestLogger } from '@nestjs/common';
import type { Logger } from '@libs/chain';

export function toChainLogger(nestLogger: NestLogger): Logger {
  return {
    info: (msg, ...args) => nestLogger.log(msg, ...args),
    warn: (msg, ...args) => nestLogger.warn(msg, ...args),
    error: (msg, ...args) => nestLogger.error(msg, ...args),
    debug: (msg, ...args) => nestLogger.debug(msg, ...args),
  };
}
