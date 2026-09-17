// Mocks for every external the guard pulls. All created inside the jest.mock
// factories (not captured from outer consts) to avoid the SWC hoisting TDZ.
jest.mock('@borradh-workspace/auth/server', () => ({ auth: { api: {} } }), {
  virtual: true,
});

jest.mock(
  '@borradh-workspace/features/auth',
  () => ({ getSession: jest.fn() }),
  { virtual: true }
);

jest.mock('@borradh-workspace/features/users', () => ({ getUser: jest.fn() }), {
  virtual: true,
});

jest.mock('@borradh-workspace/database', () => ({ db: {} }), { virtual: true });

jest.mock(
  '@borradh-workspace/observability',
  () => ({ setContextUser: jest.fn(), setContextOrganization: jest.fn() }),
  { virtual: true }
);

// Env is mocked so each test controls INTERNAL_SERVICE_TOKEN without
// re-evaluating t3-env. The token is fixed for the suite.
const INTERNAL_TOKEN = 'test-internal-token-abcdefghijklmnop';
jest.mock(
  '@borradh-workspace/env/api',
  () => ({
    apiEnv: { INTERNAL_SERVICE_TOKEN: 'test-internal-token-abcdefghijklmnop' },
  }),
  { virtual: true }
);

import { getSession } from '@borradh-workspace/features/auth';
import { getUser } from '@borradh-workspace/features/users';
import { setContextUser } from '@borradh-workspace/observability';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';

const mockGetSession = getSession as unknown as jest.Mock;
const mockGetUser = getUser as unknown as jest.Mock;
const mockSetContextUser = setContextUser as unknown as jest.Mock;

/** Reflector that always returns false/undefined for route metadata. */
const reflector = {
  getAllAndOverride: () => undefined,
} as never;

interface ReqOpts {
  headers?: Record<string, string>;
  remoteAddress?: string;
  cookies?: Record<string, string>;
}

function makeCtx(opts: ReqOpts): {
  ctx: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request: Record<string, unknown> = {
    headers: opts.headers ?? {},
    cookies: opts.cookies ?? {},
    socket: { remoteAddress: opts.remoteAddress },
  };
  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('AuthGuard internal service-auth path', () => {
  beforeEach(() => jest.clearAllMocks());

  const actsAsHeaders = {
    'x-internal-service-token': INTERNAL_TOKEN,
    'x-acts-as-user-id': 'user-123',
    'x-acts-as-organization-id': 'org-456',
  };

  it('(a) authorizes valid token + loopback + acts-as headers and populates principal', async () => {
    mockGetUser.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'user-123',
        email: 'owner@example.com',
        emailVerified: false,
      },
    });
    const guard = new AuthGuard(reflector);
    const { ctx, request } = makeCtx({
      headers: actsAsHeaders,
      remoteAddress: '127.0.0.1',
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toMatchObject({
      id: 'user-123',
      email: 'owner@example.com',
    });
    expect(request.activeOrganizationId).toBe('org-456');
    expect(request.sessionToken).toBe('');
    expect(mockSetContextUser).toHaveBeenCalledWith({ id: 'user-123' });
    // Email verification must NOT be enforced on this path even though the
    // loaded user is unverified.
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('falls back to a minimal principal when the user cannot be loaded', async () => {
    mockGetUser.mockResolvedValueOnce({
      success: false,
      error: { message: 'not found' },
    });
    const guard = new AuthGuard(reflector);
    const { ctx, request } = makeCtx({
      headers: actsAsHeaders,
      remoteAddress: '::1',
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-123', emailVerified: true });
  });

  it('(b) rejects valid token over a NON-loopback remoteAddress with ForbiddenException', async () => {
    const guard = new AuthGuard(reflector);
    const { ctx } = makeCtx({
      headers: actsAsHeaders,
      remoteAddress: '10.0.0.5',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it('(c) rejects a wrong token with UnauthorizedException', async () => {
    const guard = new AuthGuard(reflector);
    const { ctx } = makeCtx({
      headers: {
        ...actsAsHeaders,
        'x-internal-service-token': 'wrong-token-value-x',
      },
      remoteAddress: '127.0.0.1',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it('(d) rejects missing acts-as headers with UnauthorizedException', async () => {
    const guard = new AuthGuard(reflector);
    const { ctx } = makeCtx({
      headers: { 'x-internal-service-token': INTERNAL_TOKEN },
      remoteAddress: '127.0.0.1',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });
});

describe('AuthGuard session-cookie path (unchanged)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('(e) authorizes a normal session-cookie request', async () => {
    mockGetSession.mockResolvedValueOnce({
      success: true,
      data: {
        user: { id: 'u-1', email: 'a@b.com', name: 'A', emailVerified: true },
        session: { activeOrganizationId: 'org-1' },
      },
    });
    const guard = new AuthGuard(reflector);
    const { ctx, request } = makeCtx({
      headers: { authorization: 'Bearer session-token-xyz' },
      remoteAddress: '203.0.113.9', // non-loopback is irrelevant on the cookie path
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toMatchObject({ id: 'u-1' });
    expect(request.activeOrganizationId).toBe('org-1');
    expect(request.sessionToken).toBe('session-token-xyz');
    expect(mockGetSession).toHaveBeenCalledWith(expect.anything(), {
      sessionToken: 'session-token-xyz',
    });
  });
});

/**
 * BEARER-BEATS-COOKIE PRECEDENCE.
 *
 * `extractToken` reads `Authorization: Bearer` first and only falls back to the
 * session cookie. That is deliberate — native clients have no cookie jar — but
 * it is also the mechanism behind a production incident: impersonation swaps
 * the caller's session COOKIE, so any client still holding its old bearer keeps
 * authenticating as the OLD user while Better Auth (which reads the forwarded
 * cookie) sees the NEW one. The admin stayed on their own dashboard, the next
 * impersonate was refused, and admin 2FA failed as "TOTP not enabled".
 *
 * These pin the precedence so a change to it is a deliberate act, and so the
 * consequence for impersonation is written down next to the rule.
 */
describe('AuthGuard bearer-vs-cookie precedence', () => {
  beforeEach(() => jest.clearAllMocks());

  const ADMIN_TOKEN = 'admin-session-token';
  const IMPERSONATED_TOKEN = 'impersonated-session-token';

  const resolveAs = (userId: string) =>
    mockGetSession.mockResolvedValueOnce({
      success: true,
      data: {
        user: {
          id: userId,
          email: `${userId}@example.com`,
          emailVerified: true,
        },
        session: { activeOrganizationId: 'org-1' },
      },
    });

  it('resolves the BEARER when a bearer and a different session cookie are both present', async () => {
    resolveAs('admin-user');
    const guard = new AuthGuard(reflector);
    const { ctx, request } = makeCtx({
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      cookies: { '__Secure-better-auth.session_token': IMPERSONATED_TOKEN },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // The cookie is NOT consulted while a bearer is present.
    expect(mockGetSession).toHaveBeenCalledWith(expect.anything(), {
      sessionToken: ADMIN_TOKEN,
    });
    expect(request.user).toMatchObject({ id: 'admin-user' });
  });

  it('falls back to the session cookie when no bearer is present', async () => {
    resolveAs('impersonated-user');
    const guard = new AuthGuard(reflector);
    const { ctx, request } = makeCtx({
      cookies: { '__Secure-better-auth.session_token': IMPERSONATED_TOKEN },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockGetSession).toHaveBeenCalledWith(expect.anything(), {
      sessionToken: IMPERSONATED_TOKEN,
    });
    expect(request.user).toMatchObject({ id: 'impersonated-user' });
  });

  it('exposes session.impersonatedBy on the request so the UI can show the banner', async () => {
    mockGetSession.mockResolvedValueOnce({
      success: true,
      data: {
        user: {
          id: 'target-user',
          email: 't@example.com',
          emailVerified: true,
        },
        session: {
          activeOrganizationId: 'org-1',
          impersonatedBy: 'admin-user',
        },
      },
    });
    const guard = new AuthGuard(reflector);
    const { ctx, request } = makeCtx({
      headers: { authorization: `Bearer ${IMPERSONATED_TOKEN}` },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.impersonatedBy).toBe('admin-user');
  });
});
