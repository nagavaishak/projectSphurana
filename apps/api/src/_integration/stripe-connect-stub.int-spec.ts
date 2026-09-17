// The Stripe stub must be selected BEFORE the integrations singleton is first
// built (getStripeConnectService reads this at construction). Set it at module
// load, before any request reaches a Stripe-backed path.
process.env.STRIPE_E2E_STUB = 'true';

import { db, stripeConnectIntegration } from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
/**
 * The E2E Stripe stub actually SERVES the Connect endpoints (real Nest + real
 * Postgres, Stripe stubbed).
 *
 * `StripeConnectStubService` extends the real service and is constructed with a
 * dummy key, so any method it fails to override runs the real implementation and
 * is rejected by Stripe. That happened to `createAccountSession` and
 * `createControllerAccount` for a month (~1200 preview errors, 2026-07-11 →
 * 08-19) and nothing went red: the browser suite's only assertion on this
 * surface reads flags off the DB row, and the panel renders a soft fallback when
 * the embedded session fails.
 *
 * This file is the cheap, fast guard for that class of regression. It was
 * previously declared untestable — payments-infra.int-spec.ts carried a note
 * that account-session "would hit REAL Stripe", which was true ONLY because of
 * the gap. With the stub complete, these are ordinary integration tests.
 */
import { IntegrationsStripeController } from '../integrations/stripe/stripe.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

describe('Stripe Connect endpoints under the E2E stub', () => {
  let h: IntegrationApp | undefined;

  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  it('account-session mints a session and lazily provisions the controller account', async () => {
    const owner = await seedOrgWithMember('owner');
    h = await buildControllerApp(IntegrationsStripeController, {
      userId: owner.userId,
      organizationId: owner.organizationId,
      email: owner.email,
    });

    // No connected account seeded on purpose: this drives the lazy-provision
    // path, so createControllerAccount runs before createAccountSession. Both
    // were falling through to real Stripe.
    const res = await request(h.app.getHttpServer())
      .post('/integrations/stripe/account-session')
      .send({});

    expect(res.status).toBe(201);
    expect(typeof res.body.clientSecret).toBe('string');
    expect(res.body.clientSecret.length).toBeGreaterThan(0);

    // The lazy provision persisted a controller row — proving the second
    // stubbed method ran and its result was written, not just that the request
    // returned 2xx.
    const [row] = await db
      .select()
      .from(stripeConnectIntegration)
      .where(eq(stripeConnectIntegration.organizationId, owner.organizationId));
    expect(row).toBeDefined();
    expect(row.accountType).toBe('controller');
    expect(row.stripeAccountId).toMatch(/^acct_/);
  });

  it('account-link returns a usable onboarding link', async () => {
    const owner = await seedOrgWithMember('owner');
    h = await buildControllerApp(IntegrationsStripeController, {
      userId: owner.userId,
      organizationId: owner.organizationId,
      email: owner.email,
    });

    const res = await request(h.app.getHttpServer())
      .post('/integrations/stripe/account-link')
      .send({
        refreshUrl: 'https://example.com/refresh',
        returnUrl: 'https://example.com/return',
      });

    expect(res.status).toBe(201);
    expect(typeof res.body.url).toBe('string');
    expect(res.body.expiresAt).toBeGreaterThan(0);
  });
});
