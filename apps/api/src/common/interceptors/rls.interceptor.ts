import {
  type RlsContext,
  runWithRlsContext,
} from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, from, switchMap } from 'rxjs';
import type { ApiKeyAuthenticatedRequest } from '../guards/api-key.guard';
import type { AuthenticatedRequest } from '../guards/auth.guard';

/**
 * RLS Interceptor — establishes the per-request RLS context.
 *
 * It does NOT open a transaction. It binds `{ organizationId, userId }` into
 * AsyncLocalStorage for the duration of the request; the per-operation
 * `withOrgScope` helper then reads that context and opens a SHORT,
 * operation-scoped transaction that sets `app.current_org_id`. This is the
 * deliberate replacement for the previous request-spanning transaction, which
 * held a connection open for the whole request and orphaned it under Fly's NAT,
 * saturating the pool (see docs/rls/rls-implementation-plan.md §0 decision 2 and
 * the project-db-pool-supervisor incident).
 *
 * Routes without organization context (health, auth, public booking) bypass:
 * the open booking flow uses `withPublicOrgScope(orgId, …)` with an org resolved
 * from the public slug, not this session-derived context.
 *
 * Registered as a global interceptor in AppModule:
 *   providers: [{ provide: APP_INTERCEPTOR, useClass: RlsInterceptor }]
 */
@Injectable()
export class RlsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Inert while the flag is off: the scope helpers also passthrough, so
    // populating context would be wasted work. Straight through, no overhead.
    if (!apiEnv.RLS_ENABLED) {
      return next.handle();
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & Partial<ApiKeyAuthenticatedRequest>>();

    // Resolve organization ID from session auth or API key auth.
    const organizationId =
      request.activeOrganizationId ?? request.organization?.id;

    // Skip context for routes without an org (health, auth, pre-org-selection,
    // public booking). withOrgScope is never legitimately called on these; if it
    // were, it fail-fasts (no silent cross-org read).
    if (!organizationId) {
      return next.handle();
    }

    const rlsContext: RlsContext = {
      organizationId,
      userId: request.user?.id,
    };

    // Bind the context (AsyncLocalStorage — no DB, no transaction) for the whole
    // handler. `toPromise()` subscribes synchronously inside `runWithRlsContext`,
    // so the handler and its awaited continuations inherit the context, and each
    // `withOrgScope` inside opens its own short txn.
    return from(
      runWithRlsContext(rlsContext, () => next.handle().toPromise())
    ).pipe(
      switchMap((result) => {
        if (
          result &&
          typeof (result as Observable<unknown>).subscribe === 'function'
        ) {
          return result as Observable<unknown>;
        }
        return from(Promise.resolve(result));
      })
    );
  }
}
