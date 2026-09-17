import { createLogger } from '@borradh-workspace/observability';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { getRequestContext } from './request-context.middleware';

const logger = createLogger('HTTP');

/**
 * Paths to skip logging for (high-frequency polling endpoints)
 * Only skips successful responses - errors are always logged
 */
const SKIP_LOG_PATTERNS = [
  /^\/videos\/[^/]+$/, // GET /videos/:id (polling for status)
  /^\/videos\/[^/]+\/slots$/, // GET /videos/:id/slots (polling for slot status)
  /^\/health/, // Health checks (ALB probes, uptime monitors)
];

function shouldSkipLogging(path: string, method: string): boolean {
  if (method !== 'GET') return false;
  return SKIP_LOG_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Middleware that logs HTTP requests and responses.
 * Includes request correlation IDs for BetterStack tracing.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const context = getRequestContext();
    if (!context) {
      return next();
    }

    const skipLogging = shouldSkipLogging(context.path, context.method);

    // Log request start (skip for polling endpoints)
    if (!skipLogging) {
      logger.info(`→ ${req.method} ${context.path}`, {
        requestId: context.requestId,
        traceId: context.traceId,
        method: context.method,
        path: context.path,
        query: Object.keys(req.query).length > 0 ? req.query : undefined,
        userAgent: context.userAgent,
        ip: context.ip,
      });
    }

    // Capture response finish
    res.on('finish', () => {
      const duration = Date.now() - context.startTime;
      const statusCode = res.statusCode;

      // Always log errors, skip successful responses for polling endpoints
      if (skipLogging && statusCode < 400) {
        return;
      }

      const level =
        statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

      logger[level](
        `← ${req.method} ${context.path} ${statusCode} ${duration}ms`,
        {
          requestId: context.requestId,
          traceId: context.traceId,
          method: context.method,
          path: context.path,
          statusCode,
          duration,
          contentLength: res.get('content-length'),
        }
      );
    });

    next();
  }
}
