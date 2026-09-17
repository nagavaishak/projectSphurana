/**
 * Admin impersonation, against the REAL auth stack.
 *
 * Runs on `buildAuthenticatedApp` (real AuthGuard + GlobalAdminGuard + real
 * Better Auth + Redis-backed sessions), not the fake-identity harness, because
 * the behaviour under test IS identity resolution.
 *
 * The production incident these pin: impersonation swaps the caller's session
 * COOKIE. `AuthGuard` prefers a Bearer token over that cookie. A client that
 * keeps its old bearer therefore keeps authenticating as the ADMIN while
 * Better Auth — which the endpoint forwards the raw Cookie header to — sees
 * the TARGET. The admin stayed on their own dashboard, the second impersonate
 * was refused with "You are not allowed to impersonate users", and admin 2FA
 * then failed as "TOTP not enabled" against the target's 2FA-less account.
 */

// The platform-admin allow-list is CONFIGURATION, not behaviour, and it is
// captured at import by two consumers at once: `GlobalAdminGuard` reads
// `authEnv.ADMIN_USER_IDS`, and Better Auth's `admin()` plugin holds the same
// ARRAY REFERENCE. Real user ids are not known until sign-up, so the array is
// swapped for an empty one here and pushed into once the admin exists —
// mutating in place, so both consumers see it. Everything else about auth
// stays real.
jest.mock('@borradh-workspace/env/auth', () => {
  const actual = jest.requireActual('@borradh-workspace/env/auth');
  return { ...actual, authEnv: { ...actual.authEnv, ADMIN_USER_IDS: [] } };
});

import { db } from '@borradh-workspace/database';
import { user } from '@borradh-workspace/database';
import { authEnv } from '@borradh-workspace/env/auth';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AdminTerminalController } from '../admin-terminal/admin-terminal.controller.js';
import {
  type AuthenticatedApp,
  CookieJar,
  adminGateCookie,
  buildAuthenticatedApp,
  sessionCookie,
  sessionTokenFromSetCookie,
  signUpRealUser,
} from './auth-harness.js';
import { seedMember, seedOrganization } from './harness.js';

jest.setTimeout(120_000);

const uniq = () => Math.random().toString(36).slice(2, 10);

describe('admin impersonation (real auth)', () => {
  let harness: AuthenticatedApp;
  let adminId: string;
  let adminToken: string;
  let targetUserId: string;
  let gate: string;

  beforeAll(async () => {
    harness = await buildAuthenticatedApp(AdminTerminalController);

    const admin = await signUpRealUser({
      email: `platform-admin-${uniq()}@int-test.local`,
      name: 'Platform Admin',
    });
    adminId = admin.userId;
    adminToken = admin.token;
    // Both consumers hold this array; push, never reassign.
    (authEnv.ADMIN_USER_IDS as string[]).push(adminId);
    gate = adminGateCookie(adminId);

    const target = await signUpRealUser({
      email: `target-${uniq()}@int-test.local`,
      name: 'Target User',
    });
    targetUserId = target.userId;
    const organizationId = await seedOrganization();
    await seedMember({ organizationId, userId: targetUserId, role: 'owner' });
  });

  afterAll(async () => {
    await harness?.close();
  });

  const impersonate = (opts: { bearer?: string; cookie: string }) => {
    const req = request(harness.app.getHttpServer())
      .post('/admin-terminal/impersonate')
      .set('X-Client-Type', 'mobile')
      .set('Cookie', opts.cookie);
    if (opts.bearer) req.set('Authorization', `Bearer ${opts.bearer}`);
    return req.send({ userId: targetUserId });
  };

  const asAdminSelf = () => ({
    bearer: adminToken,
    cookie: `${sessionCookie(adminToken)}; ${gate}`,
  });

  it('mints a session for the target and hands the bearer client its token', async () => {
    const res = await impersonate(asAdminSelf());

    expect(res.status).toBe(200);
    // The half that was missing in production. Without it the caller has no
    // way to stop being the admin.
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token).not.toBe(adminToken);

    const setCookie = res.headers['set-cookie'] as unknown as string[];
    expect(sessionTokenFromSetCookie(setCookie)).toBe(res.body.token);
    // stop-impersonating cannot work without the admin_session stash.
    expect(setCookie.join(';')).toContain('admin_session');
  });

  it('the returned token authenticates as the TARGET, not the admin', async () => {
    const res = await impersonate(asAdminSelf());
    expect(res.status).toBe(200);

    // Re-enter the admin terminal carrying ONLY the impersonated identity.
    // The target is not a platform admin, so GlobalAdminGuard must refuse —
    // which is only true if the token really did switch user.
    const asTarget = await request(harness.app.getHttpServer())
      .get('/admin-terminal/organizations?limit=1')
      .set('Authorization', `Bearer ${res.body.token}`)
      .set('Cookie', gate);

    expect(asTarget.status).toBe(403);
  });

  /**
   * The production failure, reproduced: cookie swapped, bearer not. Our guards
   * see the admin (so the request is authorised and reaches the service) while
   * Better Auth reads the impersonated cookie and refuses.
   */
  it('refuses a second impersonate when the bearer and cookie disagree', async () => {
    const first = await impersonate(asAdminSelf());
    expect(first.status).toBe(200);

    const second = await impersonate({
      bearer: adminToken, // stale: still the admin
      cookie: `${sessionCookie(first.body.token)}; ${gate}`, // already the target
    });

    expect(second.status).toBe(403);
    expect(String(second.body.message)).toMatch(/not allowed to impersonate/i);
  });

  it('stop-impersonating restores the admin and returns the admin token', async () => {
    const started = await impersonate(asAdminSelf());
    expect(started.status).toBe(200);

    // Apply the response's cookies the way a browser would — the impersonate
    // response deletes the old session cookie AND sets the new one.
    const jar = new CookieJar()
      .apply(started.headers['set-cookie'] as unknown as string[])
      .set('admin_2fa_verified', `verified:${adminId}:${Date.now()}`);

    const stopped = await request(harness.app.getHttpServer())
      .post('/admin-terminal/stop-impersonating')
      .set('X-Client-Type', 'mobile')
      .set('Authorization', `Bearer ${started.body.token}`)
      .set('Cookie', jar.header())
      .send({});

    expect(stopped.status).toBe(200);
    expect(typeof stopped.body.token).toBe('string');

    // The restored token is a platform admin again — the round trip closed.
    const backAsAdmin = await request(harness.app.getHttpServer())
      .get('/admin-terminal/organizations?limit=1')
      .set('Authorization', `Bearer ${stopped.body.token}`)
      .set('Cookie', gate);
    expect(backAsAdmin.status).toBe(200);
  });

  /**
   * Same gap as the 2FA gate: a bearer client with no session cookie. The
   * endpoint forwards the browser's cookie header to Better Auth, and where
   * COOKIE_DOMAIN is unset the browser has none to send.
   */
  it('impersonates for a bearer client that holds NO session cookie', async () => {
    const res = await request(harness.app.getHttpServer())
      .post('/admin-terminal/impersonate')
      .set('X-Client-Type', 'mobile')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', gate) // the admin gate cookie only — no session cookie
      .send({ userId: targetUserId });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  /**
   * The exit path, for a client that stores no cookies.
   *
   * `stopImpersonating` reads the signed `admin_session` stash to find the
   * admin to restore. It is the one piece of an impersonation that cannot be
   * rebuilt from the bearer, so where the browser stored no cookie the admin
   * was stranded inside the impersonated account — the banner's button posted,
   * got a 400, and swallowed it.
   */
  it('stop-impersonating works for a bearer client with no cookies, given the stash', async () => {
    const started = await request(harness.app.getHttpServer())
      .post('/admin-terminal/impersonate')
      .set('X-Client-Type', 'mobile')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', gate)
      .send({ userId: targetUserId });

    expect(started.status).toBe(200);
    // Handed back precisely because this client could not store it.
    expect(typeof started.body.adminSessionToken).toBe('string');

    const stopped = await request(harness.app.getHttpServer())
      .post('/admin-terminal/stop-impersonating')
      .set('X-Client-Type', 'mobile')
      .set('Authorization', `Bearer ${started.body.token}`)
      .set('Cookie', gate) // no session cookie, no admin_session cookie
      .send({ adminSessionToken: started.body.adminSessionToken });

    expect(stopped.status).toBe(200);

    // Back to being a platform admin — the round trip closed without cookies.
    const backAsAdmin = await request(harness.app.getHttpServer())
      .get('/admin-terminal/organizations?limit=1')
      .set('Authorization', `Bearer ${stopped.body.token}`)
      .set('Cookie', gate);
    expect(backAsAdmin.status).toBe(200);
  });

  it('a non-admin cannot impersonate at all', async () => {
    const outsider = await signUpRealUser({
      email: `outsider-${uniq()}@int-test.local`,
    });

    const res = await request(harness.app.getHttpServer())
      .post('/admin-terminal/impersonate')
      .set('Authorization', `Bearer ${outsider.token}`)
      .set('Cookie', `${sessionCookie(outsider.token)}; ${gate}`)
      .send({ userId: targetUserId });

    expect(res.status).toBe(403);
  });

  it('refuses to impersonate another platform admin', async () => {
    const otherAdmin = await signUpRealUser({
      email: `other-admin-${uniq()}@int-test.local`,
    });
    (authEnv.ADMIN_USER_IDS as string[]).push(otherAdmin.userId);

    const res = await request(harness.app.getHttpServer())
      .post('/admin-terminal/impersonate')
      .set('X-Client-Type', 'mobile')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', `${sessionCookie(adminToken)}; ${gate}`)
      .send({ userId: otherAdmin.userId });

    expect(res.status).toBe(403);
  });

  it('an admin without the 2FA gate cookie is stopped before impersonating', async () => {
    const res = await request(harness.app.getHttpServer())
      .post('/admin-terminal/impersonate')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', sessionCookie(adminToken)) // no admin_2fa_verified
      .send({ userId: targetUserId });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ADMIN_2FA_REQUIRED');
  });

  it('an unauthenticated caller cannot reach the admin terminal', async () => {
    const res = await request(harness.app.getHttpServer())
      .get('/admin-terminal/organizations?limit=1')
      .set('Cookie', gate);

    expect(res.status).toBe(401);
  });

  it('a banned user cannot be impersonated into an active session', async () => {
    const banned = await signUpRealUser({
      email: `banned-${uniq()}@int-test.local`,
    });
    await db
      .update(user)
      .set({ banned: true })
      .where(eq(user.id, banned.userId));

    const res = await request(harness.app.getHttpServer())
      .post('/admin-terminal/impersonate')
      .set('X-Client-Type', 'mobile')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', `${sessionCookie(adminToken)}; ${gate}`)
      .send({ userId: banned.userId });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
