/**
 * The admin-terminal TOTP gate, against real Better Auth.
 *
 * `/admin-terminal/verify-2fa` forwards the caller's RAW cookie header to
 * `auth.api.verifyTOTP`, which resolves the session and verifies the code
 * against that user's two_factor secret. Every failure — wrong user, wrong
 * secret, no TOTP row — collapses into one client-facing "Invalid TOTP code",
 * so the endpoint is easy to get wrong and hard to diagnose from the outside.
 * That is exactly what happened in production ("it keeps saying invalid code").
 */
jest.mock('@borradh-workspace/env/auth', () => {
  const actual = jest.requireActual('@borradh-workspace/env/auth');
  return { ...actual, authEnv: { ...actual.authEnv, ADMIN_USER_IDS: [] } };
});

import { randomUUID } from 'node:crypto';
import { createOTP } from '@better-auth/utils/otp';
import { auth, symmetricEncrypt } from '@borradh-workspace/auth/server';
import { db, twoFactor, user } from '@borradh-workspace/database';
import { authEnv } from '@borradh-workspace/env/auth';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AdminTerminalController } from '../admin-terminal/admin-terminal.controller.js';
import {
  type AuthenticatedApp,
  buildAuthenticatedApp,
  sessionCookie,
  sessionTokenFromSetCookie,
  signUpRealUser,
} from './auth-harness.js';

jest.setTimeout(120_000);

/** A 32-char secret, the shape better-auth's enable-2FA route generates. */
const TOTP_SECRET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

describe('admin-terminal 2FA gate (real auth)', () => {
  let harness: AuthenticatedApp;
  let adminEmail: string;

  beforeAll(async () => {
    harness = await buildAuthenticatedApp(AdminTerminalController);

    const admin = await signUpRealUser({
      email: `gate-admin-${Math.random().toString(36).slice(2, 10)}@int-test.local`,
    });
    adminEmail = admin.email;
    (authEnv.ADMIN_USER_IDS as string[]).push(admin.userId);

    await db
      .update(user)
      .set({ twoFactorEnabled: true, role: 'admin' })
      .where(eq(user.id, admin.userId));
    await db.delete(twoFactor).where(eq(twoFactor.userId, admin.userId));
    await db.insert(twoFactor).values({
      id: randomUUID(),
      userId: admin.userId,
      // Better Auth stores this ENCRYPTED and decrypts on verify — a plaintext
      // secret here would make every code invalid.
      secret: await symmetricEncrypt({
        key: authEnv.BETTER_AUTH_SECRET,
        data: TOTP_SECRET,
      }),
      backupCodes: await symmetricEncrypt({
        key: authEnv.BETTER_AUTH_SECRET,
        data: JSON.stringify([]),
      }),
    });
  });

  afterAll(async () => {
    await harness?.close();
  });

  /**
   * A live session for the admin, minted the way the app does it: sign in, get
   * the 2FA challenge, complete it with a real code. `signInEmail` alone cannot
   * work here — the user has twoFactorEnabled, so it returns a CHALLENGE and no
   * session cookie.
   */
  const freshAdminSession = async (): Promise<string> => {
    const signIn = (await auth.api.signInEmail({
      body: { email: adminEmail, password: 'int-test-password-123' },
      asResponse: true,
    })) as globalThis.Response;
    const challengeCookies =
      (signIn.headers as { getSetCookie?: () => string[] }).getSetCookie?.() ??
      [];
    const twoFactorPair = challengeCookies
      .map((c) => c.split(';')[0])
      .find((c) => c.includes('two_factor='));
    if (!twoFactorPair) throw new Error('sign-in returned no 2FA challenge');

    const headers = new Headers();
    headers.set('cookie', twoFactorPair);
    const verified = (await auth.api.verifyTOTP({
      headers,
      body: {
        code: await createOTP(TOTP_SECRET, { digits: 6, period: 30 }).totp(),
      },
      asResponse: true,
    })) as globalThis.Response;
    const token = sessionTokenFromSetCookie(
      (
        verified.headers as { getSetCookie?: () => string[] }
      ).getSetCookie?.() ?? []
    );
    if (!token) throw new Error('2FA verification returned no session');
    return token;
  };

  // A FRESH session per call — a successful verify ROTATES the session, so a
  // shared token is dead after the first success and every later assertion
  // would be measuring that instead of the endpoint.
  const verify = async (code: string, opts: { cookie?: boolean } = {}) => {
    const token = await freshAdminSession();
    const req = request(harness.app.getHttpServer())
      .post('/admin-terminal/verify-2fa')
      .set('Authorization', `Bearer ${token}`);
    if (opts.cookie !== false) req.set('Cookie', sessionCookie(token));
    return req.send({ code });
  };

  it('accepts a live code derived from the seeded secret', async () => {
    const code = await createOTP(TOTP_SECRET, {
      digits: 6,
      period: 30,
    }).totp();

    const res = await verify(code);

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    // The gate cookie GlobalAdminGuard then looks for.
    expect(String(res.headers['set-cookie'])).toContain('admin_2fa_verified');
  });

  /**
   * The E2E runner, per-PR previews and local dev all serve the SPA from an
   * origin the session cookie was never stored for, so the browser sends none.
   * Forwarding only the browser's cookie header left Better Auth nothing to
   * resolve; it fell through to the two_factor branch and answered "Invalid two
   * factor cookie", which this endpoint reports as "Invalid TOTP code".
   */
  it('accepts a bearer client that holds NO session cookie', async () => {
    const code = await createOTP(TOTP_SECRET, {
      digits: 6,
      period: 30,
    }).totp();

    // Deliberately no Cookie header at all.
    const res = await verify(code, { cookie: false });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });

  it('rejects a wrong code', async () => {
    const res = await verify('000000');
    expect(res.status).toBe(401);
  });
});
