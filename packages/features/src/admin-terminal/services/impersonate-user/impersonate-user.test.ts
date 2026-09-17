import { describe, expect, it, vi } from '@borradh-workspace/testing';

import { impersonateUser } from './impersonate-user.service.js';

const IMPERSONATED_TOKEN = 'impersonated-session-token';

const responseWithCookies = (headers: string[]) =>
  ({
    ok: true,
    headers: { getSetCookie: () => headers },
    json: async () => ({ user: { id: 'target-user' } }),
  }) as unknown as globalThis.Response;

describe('impersonateUser', () => {
  /**
   * Every client authenticates with a Bearer token (`apps/app` sends
   * `X-Client-Type: mobile` on web and native alike) and `AuthGuard` prefers
   * that Bearer over the session cookie. If the new token is not handed back,
   * the caller's Bearer stays the ADMIN while the cookie becomes the target —
   * the UI never switches identity and the next impersonate is rejected with
   * "You are not allowed to impersonate users".
   */
  it('returns the impersonated session token so bearer clients can swap it', async () => {
    const authApi = {
      impersonateUser: vi
        .fn()
        .mockResolvedValue(
          responseWithCookies([
            `__Secure-better-auth.session_token=${IMPERSONATED_TOKEN}; Path=/; HttpOnly`,
            'better-auth.admin_session=admin-stash; Path=/; HttpOnly',
          ])
        ),
      listOrganizations: vi
        .fn()
        .mockResolvedValue({ ok: false } as unknown as globalThis.Response),
      setActiveOrganization: vi.fn(),
    };

    const result = await impersonateUser(authApi, {
      userId: 'target-user',
      cookieHeader: '__Secure-better-auth.session_token=admin-token',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.sessionToken).toBe(IMPERSONATED_TOKEN);
    // The admin_session cookie still has to reach the browser, or the admin
    // cannot get back out.
    expect(result.data.setCookieHeaders).toHaveLength(2);
  });

  it('surfaces Better Auth’s refusal message', async () => {
    const authApi = {
      impersonateUser: vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          message: 'You are not allowed to impersonate users',
        }),
      } as unknown as globalThis.Response),
      listOrganizations: vi.fn(),
      setActiveOrganization: vi.fn(),
    };

    const result = await impersonateUser(authApi, {
      userId: 'target-user',
      cookieHeader: '__Secure-better-auth.session_token=not-an-admin',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.message).toBe(
      'You are not allowed to impersonate users'
    );
  });
});
