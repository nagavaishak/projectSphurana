import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { sendSessionSwap } from './session-swap.js';

/**
 * `sendSessionSwap` is the response for a Better Auth call that REPLACED the
 * caller's session (impersonate / stop-impersonating).
 *
 * Both halves of the swap have to land. The cookie alone is not enough: every
 * client sends `X-Client-Type: mobile` and authenticates from a bearer token,
 * and `AuthGuard` prefers that bearer over the cookie. A response that forwards
 * the cookie but withholds the token leaves the caller authenticating as the
 * OLD user — which is exactly how impersonation broke in production.
 */
const makeRes = () => {
  const appended: [string, string][] = [];
  let statusCode: number | undefined;
  let body: unknown;
  const res = {
    append: (name: string, value: string) => {
      appended.push([name, value]);
    },
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (payload: unknown) => {
      body = payload;
      return res;
    },
  } as unknown as Response;
  return {
    res,
    appended,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body as Record<string, unknown>;
    },
  };
};

const SET_COOKIES = [
  '__Secure-better-auth.session_token=new-token; Path=/; HttpOnly',
  '__Secure-better-auth.admin_session=stashed-admin; Path=/; HttpOnly',
];

describe('sendSessionSwap', () => {
  it('hands a bearer client the new session token alongside the cookies', () => {
    const r = makeRes();

    sendSessionSwap(r.res, true, {
      setCookieHeaders: SET_COOKIES,
      sessionToken: 'new-token',
      body: { user: { id: 'target-user' } },
    });

    expect(r.statusCode).toBe(HttpStatus.OK);
    expect(r.body).toEqual({
      user: { id: 'target-user' },
      token: 'new-token',
    });
  });

  it('forwards EVERY Set-Cookie header, including admin_session', () => {
    const r = makeRes();

    sendSessionSwap(r.res, true, {
      setCookieHeaders: SET_COOKIES,
      sessionToken: 'new-token',
      body: {},
    });

    // Dropping admin_session would strand the admin inside the impersonated
    // session with no way back — stop-impersonating reads that cookie.
    expect(r.appended).toEqual([
      ['Set-Cookie', SET_COOKIES[0]],
      ['Set-Cookie', SET_COOKIES[1]],
    ]);
  });

  it('withholds the token from a cookie-only client', () => {
    const r = makeRes();

    sendSessionSwap(r.res, false, {
      setCookieHeaders: SET_COOKIES,
      sessionToken: 'new-token',
      body: { user: { id: 'target-user' } },
    });

    expect(r.body).toEqual({ user: { id: 'target-user' } });
    expect(r.body.token).toBeUndefined();
  });

  it('omits the token when Better Auth issued no session cookie', () => {
    const r = makeRes();

    sendSessionSwap(r.res, true, {
      setCookieHeaders: [],
      sessionToken: undefined,
      body: { user: { id: 'target-user' } },
    });

    expect(r.body).toEqual({ user: { id: 'target-user' } });
  });

  it('passes Better Auth’s body through unchanged apart from the token', () => {
    const r = makeRes();
    const betterAuthBody = {
      session: { id: 's-1', impersonatedBy: 'admin-user' },
      user: { id: 'target-user', email: 't@example.com' },
    };

    sendSessionSwap(r.res, true, {
      setCookieHeaders: SET_COOKIES,
      sessionToken: 'new-token',
      body: betterAuthBody,
    });

    expect(r.body).toMatchObject(betterAuthBody);
  });
});
