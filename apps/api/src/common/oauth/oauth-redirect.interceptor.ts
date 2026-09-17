import { apiEnv } from '@borradh-workspace/env/api';
import { isOAuthRedirect } from '@borradh-workspace/features/shared/oauth';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { type Observable, map } from 'rxjs';

/** The web origin a callback sends the browser back to. */
export function webOrigin(): string {
  return apiEnv.APP_URL ?? apiEnv.WEB_URL ?? 'http://localhost:3000';
}

/**
 * Renders an `OAuthRedirectResult` returned by a callback use case as a real
 * 302, prefixing the site-relative path with the web origin.
 *
 * This is the "response shaping is an Interceptor" half of Gate 5's argument.
 * It is what lets every OAuth callback handler drop `@Res()` and shrink to one
 * line — and, more usefully, it means the origin is resolved in exactly one
 * place instead of the eight copies of
 * `apiEnv.APP_URL ?? apiEnv.WEB_URL ?? 'http://localhost:3000'` these handlers
 * used to carry.
 *
 * Anything that is not a redirect outcome passes through untouched, so this is
 * safe to attach at controller scope alongside ordinary JSON routes.
 */
@Injectable()
export class OAuthRedirectInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((value) => {
        if (!isOAuthRedirect(value)) return value;
        // The outbound leg carries an absolute provider URL; prefixing it with
        // our origin would produce a redirect to a nonexistent local path and
        // fail only at runtime, in a browser, on a third-party consent flow.
        res.redirect(
          value.external ? value.path : `${webOrigin()}${value.path}`
        );
        return undefined;
      })
    );
  }
}
