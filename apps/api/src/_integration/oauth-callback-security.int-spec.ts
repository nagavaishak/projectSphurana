import { signOAuthState } from '@borradh-workspace/features/shared/oauth';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { OAuthStateGuard } from '../common/oauth/index.js';
import { IntegrationsController } from '../integrations/integrations.controller.js';

/**
 * The OAuth callback surface, driven over a real socket.
 *
 * WHAT THIS EXISTS TO PROVE. Every callback here is unauthenticated by
 * necessity — the provider redirects a browser to it — and each one used to
 * recover the acting organization by base64-decoding the `state` query param
 * and trusting it. `state` is caller-supplied, so anyone who could reach the
 * callback could name any organization. The exploit required no special access:
 * start a normal connect flow, read `state` out of your own address bar, swap
 * the `organizationId`, replay. For Stripe Connect that redirects a victim
 * organization's payouts to an attacker's connected account.
 *
 * Unit tests cover the signing scheme itself (see
 * packages/features/src/shared/oauth-state.test.ts). This file covers the thing
 * unit tests structurally cannot: that the guard is actually WIRED to these
 * routes, that its rejection is rendered as the friendly redirect rather than a
 * JSON 403, and that a genuinely-signed state still gets through. Every one of
 * those is a property of the Nest pipeline, not of a function.
 *
 * NOTE ON COVERAGE: these assertions stop at the point where a provider network
 * call would begin. A forged state is rejected BEFORE any exchange, which is
 * exactly the boundary worth pinning; the happy path past the exchange belongs
 * to the provider-specific suites.
 */

const FORGED_ORG = 'victim-org-id';

/** Exactly the pre-fix format: base64 JSON, no signature. */
const legacyUnsignedState = (organizationId: string, provider: string) =>
  Buffer.from(
    JSON.stringify({
      organizationId,
      userId: 'victim-user-id',
      provider,
      timestamp: Date.now(),
    })
  ).toString('base64');

describe('OAuth callback state verification', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET ??=
      'integration-test-secret-at-least-32-chars';

    const moduleRef = await Test.createTestingModule({
      controllers: [IntegrationsController],
      providers: [Reflector, OAuthStateGuard],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  // Every unauthenticated callback, so a newly-added one cannot quietly skip
  // the guard.
  const callbacks: Array<{ path: string; provider: string; label: string }> = [
    {
      path: '/integrations/email/callback/gmail',
      provider: 'gmail',
      label: 'gmail',
    },
    {
      path: '/integrations/email/callback/outlook',
      provider: 'outlook',
      label: 'outlook',
    },
    {
      path: '/integrations/calendar/callback/google',
      provider: 'google_calendar',
      label: 'calendar',
    },
    {
      path: '/integrations/meta-ads/callback',
      provider: 'meta_ads',
      label: 'meta-ads',
    },
    {
      path: '/integrations/instagram/callback',
      provider: 'instagram',
      label: 'instagram',
    },
    {
      path: '/integrations/stripe/callback',
      provider: 'stripe',
      label: 'stripe',
    },
    {
      path: '/integrations/booking/callback/calendly',
      provider: 'calendly',
      label: 'calendly',
    },
    {
      path: '/integrations/booking/callback/timely',
      provider: 'timely',
      label: 'timely',
    },
    {
      path: '/integrations/google-my-business/callback',
      provider: 'google_my_business',
      label: 'google-my-business',
    },
  ];

  describe.each(callbacks)('$path', ({ path, provider, label }) => {
    it('REJECTS a forged unsigned state naming another organization', async () => {
      const res = await request(app.getHttpServer())
        .get(path)
        .query({
          code: 'provider-auth-code',
          state: legacyUnsignedState(FORGED_ORG, provider),
        });

      expect(res.status).toBe(302);
      // Lands on the generic expiry message — and crucially NOT on any success
      // path, and never having reached the token exchange.
      expect(res.headers.location).toContain('status=error');
      expect(res.headers.location).toContain(`integration=${label}`);
      expect(res.headers.location).toContain('Connection+expired');
      expect(res.headers.location).not.toContain(FORGED_ORG);
    });

    it('REJECTS a missing state', async () => {
      const res = await request(app.getHttpServer())
        .get(path)
        .query({ code: 'provider-auth-code' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('status=error');
    });

    it('REJECTS a state signed for a DIFFERENT provider', async () => {
      const wrongProvider = provider === 'gmail' ? 'stripe' : 'gmail';
      const state = signOAuthState({
        organizationId: FORGED_ORG,
        userId: 'u1',
        provider: wrongProvider,
      });

      const res = await request(app.getHttpServer())
        .get(path)
        .query({ code: 'provider-auth-code', state });

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('status=error');
      expect(res.headers.location).toContain('Connection+expired');
    });

    it('ACCEPTS a correctly signed state (reaches the handler)', async () => {
      // No `code`, so the handler takes the provider-error branch and returns
      // BEFORE any network call. What is being asserted is that the guard let
      // it through at all — the redirect differs from the rejection message.
      const state = signOAuthState({
        organizationId: 'org-under-test',
        userId: 'user-under-test',
        provider,
      });

      const res = await request(app.getHttpServer())
        .get(path)
        .query({ state, error: 'access_denied' });

      expect(res.status).toBe(302);
      // Reached the handler: it renders the provider's cancellation message,
      // which the guard's rejection path never produces.
      expect(res.headers.location).not.toContain('Connection+expired');
      expect(res.headers.location).toContain('error');
    });
  });
});
