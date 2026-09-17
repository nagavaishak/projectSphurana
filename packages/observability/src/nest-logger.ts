import type { LoggerService } from '@nestjs/common';
import { type LogContext, type Logger, createLogger } from './logger.js';

/**
 * NestJS-compatible logger adapter that uses Pino under the hood.
 * Sends logs to Better Stack (Logtail) in production.
 *
 * Usage in main.ts:
 * ```ts
 * import { NestLogger } from '@borradh-workspace/observability';
 *
 * const app = await NestFactory.create(AppModule, {
 *   logger: new NestLogger(),
 * });
 * ```
 *
 * Usage in controllers/services:
 * ```ts
 * import { NestLogger } from '@borradh-workspace/observability';
 *
 * @Controller('users')
 * export class UsersController {
 *   private readonly logger = new NestLogger('UsersController');
 * }
 * ```
 */
export class NestLogger implements LoggerService {
  private logger: Logger;

  constructor(context?: string) {
    this.logger = createLogger(context || 'NestJS');
  }

  /**
   * Write a 'log' level log (maps to 'info').
   */
  log(message: string, ...optionalParams: unknown[]): void {
    const { context, extra } = this.parseParams(optionalParams);
    const logContext = context ? this.logger.child({ context }) : this.logger;
    logContext.info(message, extra);
  }

  /**
   * Write an 'error' level log.
   */
  error(message: string, ...optionalParams: unknown[]): void {
    const { context, extra, stack } = this.parseParams(optionalParams);
    const logContext = context ? this.logger.child({ context }) : this.logger;
    logContext.error(message, { ...extra, ...(stack && { stack }) });
  }

  /**
   * Write a 'warn' level log.
   */
  warn(message: string, ...optionalParams: unknown[]): void {
    const { context, extra } = this.parseParams(optionalParams);
    const logContext = context ? this.logger.child({ context }) : this.logger;
    logContext.warn(message, extra);
  }

  /**
   * Write a 'debug' level log.
   */
  debug?(message: string, ...optionalParams: unknown[]): void {
    const { context, extra } = this.parseParams(optionalParams);
    const logContext = context ? this.logger.child({ context }) : this.logger;
    logContext.debug(message, extra);
  }

  /**
   * Write a 'verbose' level log (maps to 'debug').
   */
  verbose?(message: string, ...optionalParams: unknown[]): void {
    const { context, extra } = this.parseParams(optionalParams);
    const logContext = context ? this.logger.child({ context }) : this.logger;
    logContext.debug(message, extra);
  }

  /**
   * Write a 'fatal' level log.
   */
  fatal?(message: string, ...optionalParams: unknown[]): void {
    const { context, extra, stack } = this.parseParams(optionalParams);
    const logContext = context ? this.logger.child({ context }) : this.logger;
    logContext.fatal(message, { ...extra, ...(stack && { stack }) });
  }

  /**
   * Set the log context (module name).
   */
  setContext(context: string): void {
    this.logger = createLogger(context);
  }

  /**
   * Parse NestJS optional params format.
   * NestJS can pass: (message, context) or (message, trace, context)
   */
  private parseParams(optionalParams: unknown[]): {
    context?: string;
    stack?: string;
    extra: LogContext;
  } {
    let context: string | undefined;
    let stack: string | undefined;
    const extra: LogContext = {};

    for (const param of optionalParams) {
      if (typeof param === 'string') {
        // If it looks like a stack trace
        if (param.includes('\n') && param.includes('at ')) {
          stack = param;
        } else {
          // It's a context string
          context = param;
        }
      } else if (param instanceof Error) {
        extra.error = {
          name: param.name,
          message: param.message,
          stack: param.stack,
        };
        stack = param.stack;
      } else if (typeof param === 'object' && param !== null) {
        Object.assign(extra, param);
      }
    }

    return {
      context,
      stack,
      extra: Object.keys(extra).length > 0 ? extra : undefined,
    } as {
      context?: string;
      stack?: string;
      extra: LogContext;
    };
  }
}

/**
 * Create a logger for a specific context (controller, service, etc.)
 *
 * Usage:
 * ```ts
 * import { createNestLogger } from '@borradh-workspace/observability';
 *
 * const logger = createNestLogger('UsersController');
 * logger.log('User created', { userId: '123' });
 * ```
 */
export const createNestLogger = (context: string): NestLogger => {
  return new NestLogger(context);
};
