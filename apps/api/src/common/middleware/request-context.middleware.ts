import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { withObservabilityContext } from '@borradh-workspace/observability';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId: string;
  traceId: string;
  method: string;
  path: string;
  userAgent?: string;
  ip?: string;
  userId?: string;
  startTime: number;
}

// Async local storage for request-scoped context
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Get the current request context from async local storage.
 * Returns undefined if called outside of a request context.
 */
export const getRequestContext = (): RequestContext | undefined => {
  return requestContextStorage.getStore();
};

/**
 * Get the current request ID, or 'unknown' if not in request context.
 */
export const getRequestId = (): string => {
  return getRequestContext()?.requestId ?? 'unknown';
};

/**
 * Middleware that creates a request context with correlation IDs.
 * This enables request tracing across all logs.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Use incoming trace ID if provided, otherwise generate new one
    const traceId =
      (req.headers['x-trace-id'] as string) ||
      (req.headers['x-request-id'] as string) ||
      randomUUID();

    const requestId = randomUUID();

    const context: RequestContext = {
      requestId,
      traceId,
      method: req.method,
      path: req.originalUrl || req.url,
      userAgent: req.headers['user-agent'],
      ip: req.ip || (req.headers['x-forwarded-for'] as string),
      startTime: Date.now(),
    };

    // Set response headers for tracing
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Trace-Id', traceId);

    // Run the rest of the request in both contexts:
    // - requestContextStorage for API-specific context
    // - observability context for PostHog user tracking
    requestContextStorage.run(context, () => {
      withObservabilityContext(
        {
          requestId,
          traceId,
          httpMethod: context.method,
          httpPath: context.path,
          userAgent: context.userAgent,
        },
        () => {
          next();
        }
      );
    });
  }
}
