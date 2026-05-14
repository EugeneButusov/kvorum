import type { Logger as NestLogger } from '@nestjs/common';
import type { Logger as ChainLogger } from '@libs/chain';

/** Adapts NestJS Logger (log/warn/error/debug) to shared chain-style logger ports. */
export function toChainLogger(nestLogger: NestLogger): ChainLogger {
  return {
    debug: (message, ...args) => nestLogger.debug(message, ...args),
    info: (message, ...args) => nestLogger.log(message, ...args),
    warn: (message, ...args) => nestLogger.warn(message, ...args),
    error: (message, ...args) => nestLogger.error(message, ...args),
  };
}
