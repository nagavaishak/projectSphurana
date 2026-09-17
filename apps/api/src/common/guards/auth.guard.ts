import { timingSafeEqual } from 'node:crypto';
import { auth } from '@borradh-workspace/auth/server';
import { db } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { authEnv } from '@borradh-workspace/env/auth';
import { getSession } from '@borradh-workspace/features/auth';
import { getUser } from '@borradh-workspace/features/users';
import {
  setContextOrganization,
  setContextUser,
} from '@borradh-workspace/observability';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ADMIN_2FA_COOKIE } from './global-admin.guard';
import { attachActiveLocation } from './location.guard';

/** HTTP methods that don't mutate state — the only ones allowed under override. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Decorator to mark a route as public (bypass auth entirely).
 * Use on endpoints within guarded controllers that need to be accessed without authentication
 * (e.g., mobile upload token verification).
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Dedup window for admin org-override audit lines: at most one log per
 * (admin, target org) per this interval, so a normal viewing session (which
 * fires many GETs) produces one entry, not dozens. Matches the admin 2FA TTL.
 */
const OVERRIDE_AUDIT_TTL_MS = 15 * 60 * 1000;
const recentOverrideAudits = new Map<string, number>();

/**
 * Extended Request type with authenticated user
 */
export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email?: string;
    name?: string;
    emailVerified?: boolean;
    role?: string | null;
    twoFactorEnabled?: boolean | null;
    createdAt?: Date;
    updatedAt?: Date;
  };
  sessionToken: string;
  activeOrganizationId?: string;
  /**
   * The branch this request is scoped to, set by `LocationGuard` from the
   * `X-Location-Id` header AFTER proving it belongs to `activeOrganizationId`.
   * Undefined means no branch was selected — read it as org-wide, never as
   * "no results".
   */
  activeLocationId?: string;
  /** If set, the current session is an impersonation by this admin user ID */
  impersonatedBy?: string;
  /**
   * If true, `activeOrganizationId` was overridden via the admin org-override
   * header (`X-Admin-Organization-Id`) by a verified platform admin rather than
   * resolved from the session. Lets the admin panel view any org's data.
   */
  adminOrgOverride?: boolean;
}

/**
 * Auth Guard - Validates session from cookies or Authorization header
 *
 * This guard:
 * 1. Extracts session token from cookies (primary) or Authorization header (fallback)
 * 2. Validates the session against Redis via the features package
 * 3. Attaches the user object to the request for use in controllers
 *
 * Usage:
 * ```typescript
 * @UseGuards(AuthGuard)
 * @Controller('protected')
 * export class ProtectedController {
 *   @Get()
 *   getProtectedData(@CurrentUser() user: AuthenticatedRequest['user']) {
 *     return { userId: user.id };
 *   }
 * }
 * ```
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly reflector: Reflector) {}

  /**
   * Emit a structured warning when a guarded request is rejected as
   * unauthenticated. These 401s are thrown *before* the HTTP-logging
   * interceptor runs, so without this they are invisible in BetterStack.
   * `hasCookie`/`hasBearer` distinguish the common failure mode where a
   * Bearer-authenticated SPA initiates a cookie-only full-page navigation
   * (e.g. integration OAuth) without a live session cookie.
   */
  private logRejection(request: AuthenticatedRequest, reason: string): void {
    this.logger.warn('Auth rejected: unauthenticated request', {
      reason,
      path: request.originalUrl ?? request.url,
      method: request.method,
      hasCookie: Boolean(
        request.cookies?.['__Secure-better-auth.session_token']
      ),
      hasBearer: Boolean(request.headers.authorization?.startsWith('Bearer ')),
      userAgent: request.headers['user-agent'],
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Internal service-auth path (loopback acts-as). Honored ONLY when the
    // `x-internal-service-token` header is present. This lets in-process callers
    // (the Claire WhatsApp worker) make authenticated API calls AS a paired
    // owner without a browser session. Security boundary = a shared secret +
    // loopback-only origin + explicit acts-as identity. Must run BEFORE the
    // normal token path; all other requests fall through unchanged.
    const internalToken = request.headers['x-internal-service-token'];
    if (typeof internalToken === 'string' && internalToken.length > 0) {
      return this.authenticateInternal(request, internalToken);
    }

    const token = this.extractToken(request);
    if (!token) {
      this.logRejection(request, 'no_token');
      throw new UnauthorizedException('Authentication required');
    }

    const result = await getSession(auth.api, { sessionToken: token });

    if (!result.success) {
      this.logRejection(request, 'session_invalid');
      throw new UnauthorizedException(result.error.message);
    }

    // Attach user, token, and active organization to request for use in controllers
    request.user = result.data.user;
    request.sessionToken = token;
    request.activeOrganizationId =
      result.data.session?.activeOrganizationId ?? undefined;

    // Self-heal a session with no active organization.
    //
    // Better Auth mints a NEW session on email verification, and that session
    // does not inherit `activeOrganizationId` from the one it replaces. The
    // frontend's `setActiveOrganizationIfNeeded` patches whichever session was
    // current when it ran, so the browser can end up holding a newer, org-less
    // session while an older one carries the org. Every org-scoped endpoint
    // then fails in a way that never mentions organizations — the Meta OAuth
    // state silently dropped `organizationId` (JSON.stringify omits undefined
    // keys) and reported "Connection expired"; website analysis reported
    // "Organization ID is required".
    //
    // Only auto-selects when the user belongs to EXACTLY ONE organization, so
    // this can never guess the wrong business for a multi-org user. Scoped to
    // this request; it does not write the session.
    if (!request.activeOrganizationId && result.data.user?.id) {
      try {
        const memberships = await db.query.member.findMany({
          where: (m, { eq }) => eq(m.userId, result.data.user.id),
          columns: { organizationId: true },
          limit: 2,
        });
        if (memberships.length === 1) {
          request.activeOrganizationId = memberships[0]?.organizationId;
        }
      } catch {
        // Never block a request on the recovery path.
      }
    }
    request.impersonatedBy =
      (result.data.session as { impersonatedBy?: string })?.impersonatedBy ??
      undefined;

    // Admin org-override: a verified platform admin (in ADMIN_USER_IDS with a
    // valid admin 2FA cookie — the same gate as GlobalAdminGuard) may inspect
    // any org's data by sending the `X-Admin-Organization-Id` header. This swaps
    // only the request-scoped active org, NOT the session, so every
    // @ActiveOrganization() endpoint resolves the selected org with no change.
    // Non-admins (or admins without the 2FA cookie) sending the header are
    // ignored.
    const orgOverride = request.headers['x-admin-organization-id'];
    if (
      typeof orgOverride === 'string' &&
      orgOverride.length > 0 &&
      authEnv.ADMIN_USER_IDS.includes(result.data.user.id) &&
      request.cookies?.[ADMIN_2FA_COOKIE]
    ) {
      // The override lets a verified admin read ANOTHER org's data. Enforce
      // read-only server-side — the admin panel UI is read-only, but that
      // guarantee must not depend on the client. Any state-changing method
      // under an override is rejected (the global MemberGuard runs before this
      // guard, so it is NOT a backstop here).
      const method = request.method.toUpperCase();
      if (!SAFE_METHODS.has(method)) {
        throw new ForbiddenException(
          'Admin organization override is read-only'
        );
      }

      request.activeOrganizationId = orgOverride;
      request.adminOrgOverride = true;

      this.auditOrgOverrideAccess(
        result.data.user.id,
        orgOverride,
        method,
        request.originalUrl || request.url
      );
    }

    // Set acting user in observability context for PostHog tracking. email/name
    // are $set onto the user's PostHog person by the tracking wrappers (no extra
    // $identify event per request), so API-driven events name the person too.
    setContextUser({
      id: result.data.user.id,
      email: result.data.user.email,
      name: result.data.user.name,
    });

    // Set the active org so request-scoped captures (incl. $ai_generation from
    // the shared AI clients) attribute to the `organization` PostHog group.
    if (request.activeOrganizationId) {
      setContextOrganization(request.activeOrganizationId);
    }

    // NO email-verification check.
    //
    // This used to 403 every authenticated route for an unverified address,
    // with 21 handlers opting out one at a time — and the opt-outs were
    // exactly the routes onboarding needs, which is the tell: the requirement
    // was never wanted, only tolerated.
    //
    // It is incompatible with how accounts are created now. An onboarding
    // specialist signs the customer up and completes onboarding on their
    // behalf, so the person driving the product is routinely not the person
    // who can open the mailbox. Better Auth already agrees — sign-in has never
    // required a verified address (`requireEmailVerification` is off in
    // packages/auth/src/server.ts).
    //
    // The verification email is still sent on sign-up and the account page
    // still offers to resend it, so an address can be verified whenever the
    // customer wants; nothing depends on it.

    // Resolve the branch here, where the org is finally known — including after
    // the self-heal and the admin org-override above, both of which can CHANGE
    // it. `LocationGuard` is a global APP_GUARD and this guard is class-level,
    // and NestJS composes `[...global, ...class, ...method]`, so the guard ran
    // first, found no `activeOrganizationId`, and took its early return on
    // every request — leaving `@ActiveLocation()` undefined in production and
    // branch scoping entirely inert. Calling it from here removes the ordering
    // dependency rather than relying on getting the order right.
    await attachActiveLocation(
      request,
      request.activeOrganizationId,
      this.logger
    );

    return true;
  }

  /**
   * Authenticate an internal service-auth request (loopback acts-as).
   *
   * Defense in depth, all required:
   *  1. `INTERNAL_SERVICE_TOKEN` must be configured and match the supplied
   *     header via a timing-safe, length-guarded compare.
   *  2. The request must originate from loopback (`127.0.0.1` / `::1` /
   *     `::ffff:127.0.0.1`) — even a leaked token can't be used over the
   *     internet-facing API.
   *  3. `x-acts-as-user-id` + `x-acts-as-organization-id` must both be present.
   *
   * On success the principal is populated from the user record (best effort)
   * and email verification is skipped (the worker acts as an already-onboarded
   * paired owner).
   */
  private async authenticateInternal(
    request: AuthenticatedRequest,
    suppliedToken: string
  ): Promise<boolean> {
    const expected = apiEnv.INTERNAL_SERVICE_TOKEN;
    if (!expected || !this.tokensMatch(expected, suppliedToken)) {
      throw new UnauthorizedException('Invalid internal service credential');
    }

    if (!this.isLoopback(request.socket?.remoteAddress)) {
      throw new ForbiddenException(
        'Internal service auth is only available over loopback'
      );
    }

    const actsAsUserId = request.headers['x-acts-as-user-id'];
    const actsAsOrgId = request.headers['x-acts-as-organization-id'];
    if (
      typeof actsAsUserId !== 'string' ||
      actsAsUserId.length === 0 ||
      typeof actsAsOrgId !== 'string' ||
      actsAsOrgId.length === 0
    ) {
      throw new UnauthorizedException(
        'Internal service auth requires acts-as headers'
      );
    }

    // Load the user to fill email/name/role; fall back to a minimal principal
    // if the record can't be loaded so the acts-as identity is still honored.
    const userResult = await getUser(db, { id: actsAsUserId });
    request.user = userResult.success
      ? userResult.data
      : { id: actsAsUserId, emailVerified: true };
    request.sessionToken = '';
    request.activeOrganizationId = actsAsOrgId;

    setContextUser({ id: actsAsUserId });

    // Email verification is intentionally NOT enforced on this path.
    return true;
  }

  /** Timing-safe, length-guarded token comparison. */
  private tokensMatch(expected: string, supplied: string): boolean {
    const expectedBuf = Buffer.from(expected);
    const suppliedBuf = Buffer.from(supplied);
    if (expectedBuf.length !== suppliedBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, suppliedBuf);
  }

  /** True for the loopback interface addresses. */
  private isLoopback(remoteAddress: string | undefined): boolean {
    return (
      remoteAddress === '127.0.0.1' ||
      remoteAddress === '::1' ||
      remoteAddress === '::ffff:127.0.0.1'
    );
  }

  /**
   * Record that a platform admin viewed another org's data via the override.
   * Deduped per (admin, org) within OVERRIDE_AUDIT_TTL_MS so one viewing
   * session yields a single line. Logged (Pino -> BetterStack) to match how
   * impersonation is recorded; admin actions aren't written to the org-scoped
   * `audit_log` table and `audit_action` has no read/access value.
   */
  private auditOrgOverrideAccess(
    adminId: string,
    organizationId: string,
    method: string,
    path: string
  ): void {
    const key = `${adminId}:${organizationId}`;
    const now = Date.now();
    const last = recentOverrideAudits.get(key);
    if (last && now - last < OVERRIDE_AUDIT_TTL_MS) return;
    recentOverrideAudits.set(key, now);
    this.logger.warn(
      `admin org-override access: admin=${adminId} targetOrg=${organizationId} entry=${method} ${path}`
    );
  }

  /**
   * Extract session token from cookies or Authorization header
   */
  private extractToken(request: Request): string | null {
    // Check Authorization header first (for API clients)
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // Fall back to cookie (for browser clients)
    // Always use secure cookie name - all environments use HTTPS via cloudflared tunnel
    return request.cookies?.['__Secure-better-auth.session_token'] || null;
  }
}
