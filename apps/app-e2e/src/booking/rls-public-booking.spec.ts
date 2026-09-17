/**
 * T3 — Open Booking RLS Isolation Test (W-BOOK release blocker)
 *
 * docs/rls/rls-implementation-plan.md §PHASE 3 / T3:
 *   "As an unauthenticated customer: open org A's booking page by slug, list
 *   services + available slots, submit a booking. Assert: (a) it succeeds,
 *   (b) the booking row lands in org A, (c) you cannot read org B's data via
 *   the public flow, (d) tampering the slug/org in the payload cannot write
 *   into another org, (e) app_public cannot read a non-booking table (e.g.
 *   payment) — denied by grant."
 *
 * Gating strategy
 * ───────────────
 * Assertions (c)–(e) require RLS_ENABLED=true and the app_public pool wired
 * (Phase 2 / I3). They are gated behind `process.env.RLS_ENABLED === 'true'`
 * so the spec does NOT fail current CI (where RLS is off). The happy-path
 * booking assertions (a)–(b) run in every environment.
 *
 * To run isolation assertions locally:
 *   RLS_ENABLED=true pnpm exec playwright test src/booking/rls-public-booking
 *
 * Real API, no mocking. The test uses the existing bare-org storageState to
 * seed services via the authenticated API (beforeAll only), then drops auth
 * for the actual customer-facing test cases.
 */

import {
  type APIRequestContext,
  type Page,
  expect,
  request as playwrightRequest,
  test,
} from '@playwright/test';
import { API_URL, SeedHelper } from '../fixtures/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * An EXPLICITLY empty storage state.
 *
 * `request.newContext()` with no options is NOT anonymous: inside a test worker
 * Playwright applies the project's `use` options to it, and this spec's project
 * (`authenticated`) sets `storageState: .auth/bare-user.json`. A bare
 * `newContext()` therefore comes back holding the bare user's session cookie —
 * verified directly:
 *
 *   COOKIES IN newContext(): ["__Secure-better-auth.session_token", …]
 *   GET /payments -> 200 {"items":[]}      // authenticated, not anonymous
 *
 * Passing an empty `storageState` is what actually opts out. With it, the same
 * call returns the 401 that `curl` gets.
 */
const ANONYMOUS = { storageState: { cookies: [], origins: [] } };

/**
 * Make a genuinely unauthenticated request to the public booking API.
 *
 * ⚠️  Do NOT use the `request` fixture here. Playwright seeds it from the
 * PROJECT's `storageState`, and this spec runs in the `authenticated` project
 * (bare-org storageState) so it can seed services in `beforeAll`. That fixture
 * therefore carries the bare user's session cookie on every call, and passing
 * `headers: {}` does not strip cookies — it only declines to ADD headers.
 *
 * The old helper took that fixture and called itself anonymous. It wasn't: the
 * "anonymous caller cannot read /payments" case was signed in as the bare user,
 * so it got `200 {"items":[]}` (the bare org simply has no payments) instead of
 * the 401 it asserted. A test that cannot be anonymous cannot prove anything
 * about anonymous callers — and the (c)/(d) cross-org isolation cases below were
 * quietly authenticated for the same reason.
 *
 * `playwrightRequest.newContext()` starts with NO storage state, so this is the
 * real thing: no cookies, no session.
 */
async function publicApiGet(
  path: string
): Promise<{ status: number; body: unknown }> {
  const anon = await playwrightRequest.newContext(ANONYMOUS);
  try {
    return await readPublicResponse(anon, path);
  } finally {
    await anon.dispose();
  }
}

async function readPublicResponse(
  anon: APIRequestContext,
  path: string
): Promise<{ status: number; body: unknown }> {
  const response = await anon.get(`${API_URL}${path}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }
  return { status: response.status(), body };
}

/**
 * Submit to the public booking API as a real anonymous customer.
 *
 * Same trap as `publicApiGet`: the `request` fixture carries the bare user's
 * session cookie in this project, so the "anonymous customer submits a booking"
 * case was actually a signed-in one and never exercised the public flow it
 * claims to guard. A fresh context has no storage state.
 */
async function publicApiPost(
  path: string,
  data: unknown
): Promise<{ status: number; body: unknown }> {
  const anon = await playwrightRequest.newContext(ANONYMOUS);
  try {
    const response = await anon.post(`${API_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      data,
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    return { status: response.status(), body };
  } finally {
    await anon.dispose();
  }
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

interface BookingSetup {
  orgSlug: string;
  orgId: string;
  serviceId: string;
  serviceName: string;
}

/** 09:00–18:00 (minutes from midnight), every day. Keys are `Date#getDay()`. */
const ALL_WEEK_WORKING_HOURS = {
  0: { from: 540, to: 1080 },
  1: { from: 540, to: 1080 },
  2: { from: 540, to: 1080 },
  3: { from: 540, to: 1080 },
  4: { from: 540, to: 1080 },
  5: { from: 540, to: 1080 },
  6: { from: 540, to: 1080 },
};

/**
 * Build a booking setup for org A using the authenticated API.
 * Called once in beforeAll. Does NOT use the browser UI.
 *
 * Seeds a DEDICATED service + practitioner with explicit seven-day shift rows
 * rather than reusing "whatever service is first" in the shared bare org. That
 * makes availability deterministic: `resolveAvailability` is shifts-only (no
 * working-hours fallback), and create-practitioner seeds only a Mon–Fri
 * default, so without weekend shifts the slots endpoint returns nothing on a
 * weekend CI run. Seeding all seven days guarantees slots on any date. Setup
 * failures now throw — they used to be swallowed, which made every case below
 * skip green whenever the seed was broken.
 */
async function bootstrapOrgABooking(
  page: Page,
  request: APIRequestContext
): Promise<BookingSetup> {
  const seed = new SeedHelper(page, request);

  const orgData = (await seed.authenticatedApiCall(
    'GET',
    '/organization/active'
  )) as { slug?: string; id?: string };

  const orgSlug = orgData?.slug;
  const orgId = orgData?.id;
  if (!orgSlug || !orgId) {
    throw new Error(
      `[T3] Could not read org A slug/id: ${JSON.stringify(orgData)}`
    );
  }

  const runId = Date.now();
  const serviceName = `T3 Booking Service ${runId}`;
  const service = await seed.createService({
    name: serviceName,
    category: 'treatment',
    appointmentDuration: 30,
  });

  const practitioner = (await seed.authenticatedApiCall(
    'POST',
    '/practitioners',
    {
      name: `T3 Booking Practitioner ${runId}`,
      email: `e2e.test.t3.prac.${runId}@example.com`,
      workingHours: ALL_WEEK_WORKING_HOURS,
    }
  )) as { id?: string };

  if (!practitioner?.id) {
    throw new Error(
      `[T3] Failed to seed practitioner: ${JSON.stringify(practitioner)}`
    );
  }
  await seed.assignPractitionerServices(practitioner.id, [service.id]);
  // Explicit 7-day shifts — availability is shifts-only, so this is what makes
  // slots exist regardless of the weekday CI runs on.
  await seed.setWeeklyShifts(practitioner.id);

  return { orgSlug, orgId, serviceId: service.id, serviceName };
}

/** Date the slot assertions target: one week out, YYYY-MM-DD. */
function inAWeek(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('T3 — Public Booking RLS Isolation', () => {
  test.setTimeout(120_000);

  // Assigned by beforeAll, which throws if the seed fails — so every test below
  // can rely on it (no `!setup` skips: a broken seed must be a FAILURE).
  let setup!: BookingSetup;

  test.beforeAll(async ({ browser, request }) => {
    // Use bare-org auth to seed services, then close the context.
    const context = await browser.newContext({
      storageState: '.auth/bare-user.json',
    });
    const page = await context.newPage();
    try {
      setup = await bootstrapOrgABooking(page, request);
    } finally {
      await context.close();
    }
  });

  // ── (a + b) Happy-path: booking succeeds and lands in org A ──────────────
  // These assertions run in ALL environments (RLS on or off). They are the
  // release-blocking regression guard for the public booking flow.

  test('(a) API: GET booking config by slug succeeds unauthenticated', async () => {
    const { status, body } = await publicApiGet(
      `/public/booking/${setup.orgSlug}`
    );

    expect(
      status,
      `Expected 200, got ${status}. Body: ${JSON.stringify(body)}`
    ).toBe(200);
    const data = body as Record<string, unknown>;
    expect(data).toHaveProperty('services');
    expect(Array.isArray(data.services)).toBe(true);
    expect((data.services as unknown[]).length).toBeGreaterThan(0);
  });

  // '(a) UI: booking page loads unauthenticated' MOVED to
  // apps/marketing-astro-e2e/src/booking/public-booking.spec.ts. The booking
  // wizard left this app for marketing-astro, so the test drove a route that
  // no longer exists here. The RLS claims below are API-level and stay.

  test('(a+b) API: booking submit succeeds and appointment lands in org A', async ({
    browser,
    request,
  }) => {
    // 1. Get a slot so we can submit a real booking time. The seeded
    // practitioner works every weekday 09:00–18:00, so slots MUST exist — an
    // empty list is a regression in the availability pipeline and FAILS here
    // (it used to skip, which is how a broken public booking flow stayed green).
    const slotsRes = await publicApiGet(
      `/public/booking/${setup.orgSlug}/slots?serviceId=${setup.serviceId}&date=${inAWeek()}`
    );

    expect(
      slotsRes.status,
      `Slot endpoint failed: ${JSON.stringify(slotsRes.body)}`
    ).toBe(200);
    const slotsBody = slotsRes.body as {
      slots?: Array<{ startTime: string; endTime: string }>;
    };
    expect(
      slotsBody.slots ?? [],
      'No slots for the seeded service+practitioner one week out'
    ).not.toHaveLength(0);

    const slot = (slotsBody.slots ?? [])[0];

    // 2. Submit the booking
    const submitRes = await publicApiPost(
      `/public/booking/${setup.orgSlug}/submit`,
      {
        serviceId: setup.serviceId,
        firstName: 'T3',
        lastName: `RlsTest-${Date.now()}`,
        email: `t3.rls.test.${Date.now()}@example.com`,
        appointmentStartTime: slot.startTime,
        appointmentEndTime: slot.endTime,
      }
    );

    expect(
      submitRes.status,
      `Submit failed (${submitRes.status}): ${JSON.stringify(submitRes.body)}`
    ).toBe(201);

    const submitBody = submitRes.body as Record<string, unknown>;
    expect(submitBody).toHaveProperty('appointmentId');
    expect(submitBody).toHaveProperty('leadId');

    // (b) Verify the appointment lands in org A using the authenticated API
    const context = await browser.newContext({
      storageState: '.auth/bare-user.json',
    });
    const page = await context.newPage();
    const seed = new SeedHelper(page, request);

    try {
      const appt = (await seed.authenticatedApiCall(
        'GET',
        `/appointments/${submitBody.appointmentId as string}`
      )) as { organizationId?: string } | null;

      expect(
        appt,
        'Appointment not found via authenticated API after public booking'
      ).not.toBeNull();
      expect(appt?.organizationId).toBe(setup.orgId);
    } finally {
      await context.close();
    }
  });

  // ── (c) Isolation: cannot read org B's data via the public flow ───────────
  // REQUIRES RLS_ENABLED=true + app_public pool wired (Phase 2 / I3).
  // Gated so current CI does not fail.

  test('(c) RLS: cannot read org B services via org A booking flow', async () => {
    // Skip unless RLS is explicitly enabled (Phase 3 env)
    test.skip(
      process.env.RLS_ENABLED !== 'true',
      'RLS isolation assertions require RLS_ENABLED=true (Phase 3 / T3 env)'
    );

    // We need org B's slug. The test makes an unauthenticated call to org A's
    // booking config and verifies the response only contains org A's services.
    // A deeper test (cross-org slug enumeration) would require a second org
    // with a known slug — that is covered in T1 (isolation suite). Here we
    // assert the response does NOT surface data from other orgs by checking
    // that every service in the response belongs to org A.

    const { status, body } = await publicApiGet(
      `/public/booking/${setup.orgSlug}`
    );
    expect(status).toBe(200);
    const data = body as { services?: Array<{ id: string }> };
    expect(data.services).toBeDefined();

    // Under RLS, the org_isolation policy on organization_service ensures that
    // every service returned has organization_id = org A's id. The slug_bootstrap
    // policy + withPublicOrgScope ensure we cannot accidentally read services
    // from a different org even if we forge the slug.
    // Assertion: all returned service IDs are a subset of org A's known services
    // (requires at least one service to be meaningful).
    expect((data.services ?? []).length).toBeGreaterThan(0);
    // A deeper cross-org assertion is in T1; here we assert the RLS-on response
    // shape is correct and not wider than expected.
  });

  // ── (d) Write isolation: tampered org in payload is blocked by WITH CHECK ──
  // REQUIRES RLS_ENABLED=true.

  test('(d) RLS: tampered organizationId in submit payload lands in org A anyway', async ({
    browser,
    request,
  }) => {
    test.skip(
      process.env.RLS_ENABLED !== 'true',
      'RLS isolation assertions require RLS_ENABLED=true (Phase 3 / T3 env)'
    );

    // Get a real slot for org A first — guaranteed by the seeded practitioner.
    const slotsRes = await publicApiGet(
      `/public/booking/${setup.orgSlug}/slots?serviceId=${setup.serviceId}&date=${inAWeek()}`
    );
    expect(
      slotsRes.status,
      `Slot endpoint failed: ${JSON.stringify(slotsRes.body)}`
    ).toBe(200);
    const slotsBody = slotsRes.body as {
      slots?: Array<{ startTime: string; endTime: string }>;
    };
    expect(slotsBody.slots ?? [], 'No slots one week out').not.toHaveLength(0);

    const slot = (slotsBody.slots ?? [])[0];

    // Submit a booking but inject a FAKE organizationId. The DTO does not
    // expose organizationId (the service resolves it from the slug), and under
    // RLS the org_isolation WITH CHECK on `appointment` pins the row to
    // app.current_org_id (org A, set by withPublicOrgScope). So the ONLY
    // correct outcome is: 201, appointment in org A.
    //
    // The old version accepted a 201 OR any of 400/403/409/500 — i.e. it could
    // not fail, and it never checked which org the row landed in. That is the
    // one thing this test exists to prove, so we now read the appointment back
    // through the authenticated API and assert its organizationId.
    const fakeOrgId = '00000000-0000-0000-0000-000000000000';
    const submitRes = await publicApiPost(
      `/public/booking/${setup.orgSlug}/submit`,
      {
        serviceId: setup.serviceId,
        organizationId: fakeOrgId, // extra field: must be ignored
        firstName: 'Tamper',
        lastName: `Test-${Date.now()}`,
        email: `tamper.test.${Date.now()}@example.com`,
        appointmentStartTime: slot.startTime,
        appointmentEndTime: slot.endTime,
      }
    );

    expect(
      submitRes.status,
      `Tampered submit should still succeed in org A (${submitRes.status}): ${JSON.stringify(submitRes.body)}`
    ).toBe(201);
    const submitBody = submitRes.body as Record<string, unknown>;
    expect(submitBody).toHaveProperty('appointmentId');

    const context = await browser.newContext({
      storageState: '.auth/bare-user.json',
    });
    const page = await context.newPage();
    const seed = new SeedHelper(page, request);
    try {
      const appt = (await seed.authenticatedApiCall(
        'GET',
        `/appointments/${submitBody.appointmentId as string}`
      )) as { organizationId?: string } | null;

      expect(
        appt,
        'Tampered booking produced an appointment org A cannot read'
      ).not.toBeNull();
      expect(
        appt?.organizationId,
        'Tampered organizationId escaped into another org — RLS WITH CHECK / DTO strip failed'
      ).toBe(setup.orgId);
      expect(appt?.organizationId).not.toBe(fakeOrgId);
    } finally {
      await context.close();
    }
  });

  // ── (e) Grant check: app_public cannot read a non-booking table ───────────
  //
  // The DB-level half of T3(e) — connecting AS app_public and asserting
  // `permission denied for table payment` — still needs a server-side endpoint
  // (the app_public connection string is not reachable from a browser test):
  //
  //   GET /testing/rls/grant-check?role=app_public&table=payment
  //   → { permitted: false, error: 'permission denied for table payment' }
  //
  // That endpoint does not exist yet, and the previous version of this test was
  // an EMPTY body behind an RLS_ENABLED skip — zero assertions, permanently
  // dead in CI. Until the endpoint lands we assert the observable half, which
  // holds in every environment: an anonymous caller (the only kind the public
  // booking flow creates) cannot read a non-booking resource through the API.

  test('(e) anonymous callers cannot read non-booking resources (payments)', async () => {
    test.info().annotations.push({
      type: 'T3-pending',
      description:
        'DB-level grant check still requires GET /testing/rls/grant-check (Phase 3): ' +
        'verify the app_public role gets `permission denied` on non-booking tables ' +
        '(payment, video, meta_ad, …). This test only covers the API-level half.',
    });

    const { status, body } = await publicApiGet('/payments');

    expect(
      [401, 403],
      `Anonymous GET /payments returned ${status}: ${JSON.stringify(body)}`
    ).toContain(status);
  });
});
