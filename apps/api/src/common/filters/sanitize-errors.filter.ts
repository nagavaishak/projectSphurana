import { logError } from '@borradh-workspace/observability';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Global exception filter that sanitizes error responses.
 *
 * - 4xx errors: pass through the user-facing message from the controller/feature
 * - 5xx errors: replace with a generic message so internal details never leak
 * - Unknown exceptions (non-HttpException): treat as 500 with generic message
 *
 * Server-side, both 5xx HttpExceptions and unhandled throws are logged via
 * `logError` so they land in BetterStack as structured rows with searchable
 * fields (method, path, status, body, stack, err.cause).
 */
@Catch()
export class SanitizeErrorsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;
    let code: string | undefined;
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (status >= 500) {
        // Never expose internal error details to the client
        message = 'An unexpected error occurred';
        logError('http.unhandled5xx', exception, {
          feature: 'http',
          extra: {
            method: request.method,
            path: request.path,
            status,
            body,
          },
        });
      } else {
        // 4xx: use the message from the controller/feature
        message =
          typeof body === 'string'
            ? body
            : ((body as Record<string, unknown>).message as string) ||
              exception.message;
        // Pass through code and details (e.g., structured Meta error info)
        if (typeof body === 'object' && body !== null) {
          const bodyObj = body as Record<string, unknown>;
          if (typeof bodyObj.code === 'string') {
            code = bodyObj.code;
          }
          if (bodyObj.details && typeof bodyObj.details === 'object') {
            details = bodyObj.details as Record<string, unknown>;
          }
        }
      }
    } else {
      // Non-HttpException (unexpected throw) — always 500 + generic message
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'An unexpected error occurred';
      logError('http.unhandled', exception, {
        feature: 'http',
        extra: {
          method: request.method,
          path: request.path,
        },
      });
    }

    response.status(status).json({
      statusCode: status,
      message,
      ...(code && { code }),
      ...(details && { details }),
    });
  }
}
