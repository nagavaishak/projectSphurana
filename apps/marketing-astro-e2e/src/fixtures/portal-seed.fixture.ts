/**
 * Staff-side seeding for the customer-portal specs.
 *
 * WHY THIS EXISTS (and why it is not a copy of app-e2e's SeedHelper)
 * ─────────────────────────────────────────────────────────────────
 * The portal now lives on the marketing host (`/sites/{slug}/portal/…`), so
 * these specs run in this suite — which has no staff UI to sign in through and
 * no `.auth/*.json` storageState to inherit. app-e2e's SeedHelper is built
 * around a signed-in browser `page`; here the staff side is pure HTTP.
 *
 * So this helper holds its own `APIRequestContext` against the API and signs in
 * over `POST /auth/sign-in`, exactly as a real staff client does — the session
 * cookie lands in that context's jar and every later seed call is authenticated
 * by it. Nothing about the CUSTOMER side is faked: the browser reaches the
 * portal anonymously and must earn its session.
 *
 * PRECONDITIONS ARE SEEDED, NEVER OBSERVED
 * `/testing/provision-org` is idempotent and concurrency-safe, so the staff
 * account and its org are ensured on every run rather than assumed. Anything
 * that then fails is a real failure and throws with the status and body — it
 * never degrades into a skip.
 *
 * API_URL MUST BE THE SAME API THE MICROSITE PROXIES TO.
 * The portal talks to `/api/*` on its own origin; `src/pages/api/[...path].ts`
 * forwards that to the app's configured upstream. Seeding a DIFFERENT API
 * produces a lead the portal cannot see. In CI both are the per-PR Fly API.
 */
import type { APIRequest, APIRequestContext } from '@playwright/test';

const API_URL = process.env.API_URL || '';
const SEED_TOKEN = process.env.E2E_SEED_TOKEN || '';
const STAFF_EMAIL = process.env.TEST_BARE_USER_EMAIL || '';
const STAFF_PASSWORD = process.env.TEST_BARE_USER_PASSWORD || '';

/**
 * ENVIRONMENT gate for the portal specs — knowable before a browser opens.
 * This is the only sanctioned reason these specs skip; everything downstream
 * (an org without a slug, a lead that will not create, an OTP that will not
 * mint) is a failure, not a skip.
 */
export const PORTAL_E2E_READY = Boolean(
  API_URL && SEED_TOKEN && STAFF_EMAIL && STAFF_PASSWORD
);

export const PORTAL_E2E_SKIP_REASON =
  'Portal specs need API_URL, E2E_SEED_TOKEN, TEST_BARE_USER_EMAIL and ' +
  'TEST_BARE_USER_PASSWORD, and API_URL must be the same API the target ' +
  'marketing deployment proxies /api/* to.';

/**
 * The PATH tier — `www.borradh.io/sites/{slug}/portal/…` — is the only tier
 * that resolves today (see src/lib/microsite-org.ts). The per-tenant host tiers
 * (`{slug}.borradh.io`, custom domains) need DNS + certificates that do not
 * exist yet, so targeting them here would test a 404.
 */
export const portalPath = (slug: string, subpath = ''): string =>
  `/sites/${encodeURIComponent(slug)}/portal${subpath}`;

interface JsonAttempt {
  status: number;
  ok: boolean;
  body: string;
  json: unknown;
}

/**
 * Read a response body as TEXT first, then parse.
 *
 * `response.json()` alone turns an unhealthy preview API into
 * `SyntaxError: Unexpected token '<'` — naming neither the status nor the
 * endpoint, and reading like a bug in the caller. That cost a real debugging
 * cycle on these specs in their previous home; keep the diagnostic.
 */
async function readJson(
  label: string,
  response: {
    status(): number;
    ok(): boolean;
    text(): Promise<string>;
  }
): Promise<JsonAttempt> {
  const body = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(
      `${label}: API returned ${response.status()} with a non-JSON body ` +
        `(likely down or restarting). First 200 chars: ${body.slice(0, 200)}`
    );
  }
  return { status: response.status(), ok: response.ok(), body, json };
}

export interface SeededLead {
  id: string;
  firstName: string;
  email: string;
}

export class PortalSeed {
  private constructor(
    private readonly api: APIRequestContext,
    /** The clinic whose portal is under test. */
    readonly orgSlug: string
  ) {}

  /**
   * Ensure the staff org exists, sign in as its owner, and resolve its slug.
   *
   * Call from `beforeAll` with the worker-scoped `playwright` fixture:
   * `PortalSeed.staff(playwright.request)`.
   */
  static async staff(request: APIRequest): Promise<PortalSeed> {
    const api = await request.newContext({
      baseURL: API_URL,
      // Seed calls are non-idempotent (create lead) so they are never retried;
      // give a loaded preview API room instead.
      timeout: 60_000,
    });

    // 1. SEED the account + org. Idempotent server-side, so this is a no-op
    //    once they exist and self-heals a freshly-reset preview DB.
    const provisioned = await readJson(
      'provision-org',
      await api.post('/testing/provision-org', {
        headers: { Authorization: `Bearer ${SEED_TOKEN}` },
        data: {
          email: STAFF_EMAIL,
          password: STAFF_PASSWORD,
          name: 'E2E Bare Owner',
          orgName: 'E2E Bare Salon',
          businessType: 'salon',
        },
        // Provisioning is gated + password-KDF bound server-side; a call may
        // queue behind others. Waiting is intended.
        timeout: 120_000,
      })
    );
    const provisionBody = provisioned.json as {
      success?: boolean;
      data?: { organizationId?: string };
    };
    if (!provisioned.ok || !provisionBody?.success) {
      await api.dispose();
      throw new Error(
        `[PortalSeed] Could not provision the staff org for ${STAFF_EMAIL}: ` +
          `HTTP ${provisioned.status} — ${provisioned.body.slice(0, 300)}`
      );
    }

    // 2. Sign in as staff. The API sets the session cookie on this response and
    //    this context's jar replays it on every later call.
    const signedIn = await api.post('/auth/sign-in', {
      data: { email: STAFF_EMAIL, password: STAFF_PASSWORD },
    });
    if (!signedIn.ok()) {
      const body = await signedIn.text();
      await api.dispose();
      throw new Error(
        `[PortalSeed] Staff sign-in failed for ${STAFF_EMAIL}: HTTP ${signedIn.status()} — ${body.slice(0, 300)}. Note the session cookie is \`__Secure-\`-prefixed, so API_URL must be https.`
      );
    }

    // 3. POINT THIS session at the org.
    //
    // `/testing/provision-org` sets the active-org pointer on the session IT
    // mints, not on the one we just signed in with — and a session minted by
    // sign-in carries no `activeOrganizationId` of its own (app-e2e's
    // org.fixture.ts hits the same wall and does the same thing). Without this,
    // `GET /organization/active` answers 200 with a `null` body, which NestJS
    // sends as an EMPTY body, and every org-scoped seed call below fails with
    // "No active organization selected".
    const organizationId = provisionBody.data?.organizationId;
    if (!organizationId) {
      await api.dispose();
      throw new Error(
        `[PortalSeed] provision-org returned no organizationId: ${provisioned.body.slice(0, 300)}`
      );
    }
    const activated = await api.post('/organization/active', {
      data: { organizationId },
    });
    if (!activated.ok()) {
      const body = await activated.text();
      await api.dispose();
      throw new Error(
        `[PortalSeed] Could not set active org ${organizationId} on the staff session: HTTP ${activated.status()} — ${body.slice(0, 300)}`
      );
    }

    // 4. The slug the portal path tier is keyed by.
    const active = await readJson(
      'organization/active',
      await api.get('/organization/active')
    );
    const slug = (active.json as { slug?: string } | null)?.slug;
    if (!slug) {
      await api.dispose();
      throw new Error(
        `[PortalSeed] Staff org has no slug (HTTP ${active.status}): ${active.body.slice(0, 300)}`
      );
    }

    return new PortalSeed(api, slug);
  }

  async dispose(): Promise<void> {
    await this.api.dispose();
  }

  /**
   * One authenticated API call, as the staff owner.
   *
   * The booking specs seed through a dozen different staff endpoints
   * (services, variants, practitioners, shifts). Rather than a wrapper method
   * per endpoint — which is how app-e2e's SeedHelper grew to its current size,
   * most of them one-line passthroughs — the specs' own seed helpers compose
   * this. Throws on a non-2xx so a failed precondition is a failure, never a
   * quietly-empty fixture.
   */
  async call<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    data?: unknown
  ): Promise<T> {
    const response = await this.api.fetch(path, {
      method,
      ...(data === undefined ? {} : { data: data as object }),
    });
    const attempt = await readJson(`${method} ${path}`, response);
    if (!attempt.ok) {
      throw new Error(
        `[PortalSeed] ${method} ${path} failed: HTTP ${attempt.status} — ${attempt.body.slice(0, 300)}`
      );
    }
    return attempt.json as T;
  }

  /**
   * Mint a patient manage-booking link for an appointment.
   *
   * The raw token is never recoverable from the DB (only its SHA-256 is
   * stored), so this asks the API to issue a fresh one — exactly what the
   * confirmation email does. Seed-token auth, not the staff session.
   */
  async issueManageBookingLink(
    appointmentId: string
  ): Promise<{ token: string; url: string }> {
    const attempt = await readJson(
      'POST /testing/manage-booking-link',
      await this.api.post('/testing/manage-booking-link', {
        headers: { Authorization: `Bearer ${SEED_TOKEN}` },
        data: { appointmentId },
      })
    );
    const result = attempt.json as {
      success?: boolean;
      token?: string;
      url?: string;
      message?: string;
    };
    if (!result?.success || !result.token || !result.url) {
      throw new Error(
        `[PortalSeed] Could not issue a manage-booking link for ${appointmentId}: ${result?.message ?? attempt.body.slice(0, 200)}`
      );
    }
    return { token: result.token, url: result.url };
  }

  /** The lead the clinic "has on file" — its email is the sign-in identity. */
  async createLead(input: {
    firstName: string;
    email: string;
    /** Staff-internal commentary. NEVER shown to the customer. */
    notes?: string;
  }): Promise<SeededLead> {
    const created = await readJson(
      'POST /leads',
      await this.api.post('/leads', { data: input })
    );
    const id = (created.json as { id?: string } | null)?.id;
    if (!id) {
      throw new Error(
        `[PortalSeed] Failed to seed lead ${input.email} (HTTP ${created.status}): ${created.body.slice(0, 300)}`
      );
    }
    return { id, firstName: input.firstName, email: input.email };
  }

  /** The note addressed TO the customer (`lead.portalNote`). */
  async setPortalNote(leadId: string, portalNote: string): Promise<void> {
    const updated = await readJson(
      `PUT /leads/${leadId}`,
      await this.api.put(`/leads/${leadId}`, { data: { portalNote } })
    );
    if (!updated.ok) {
      throw new Error(
        `[PortalSeed] Failed to set portalNote on ${leadId} ` +
          `(HTTP ${updated.status}): ${updated.body.slice(0, 300)}`
      );
    }
  }

  /**
   * Mint a fresh, usable sign-in OTP.
   *
   * The emailed code is stored hashed, so the raw value is unrecoverable from
   * the DB. This asks the API for one — we stand in for the mail client, we do
   * not bypass the feature.
   */
  async patientOtp(email: string): Promise<string> {
    const minted = await readJson(
      'POST /testing/patient-otp',
      await this.api.post('/testing/patient-otp', {
        headers: { Authorization: `Bearer ${SEED_TOKEN}` },
        data: { email, organizationSlug: this.orgSlug },
      })
    );
    const otp = (minted.json as { otp?: string; message?: string } | null)?.otp;
    if (!otp) {
      throw new Error(
        `[PortalSeed] Failed to mint patient OTP for ${email} @ ${this.orgSlug} ` +
          `(HTTP ${minted.status}): ${minted.body.slice(0, 300)}`
      );
    }
    return otp;
  }

  /**
   * The staff "Copy portal link" endpoint.
   *
   * Returns the URL verbatim (so a spec can assert the SHAPE the API mints —
   * `buildPortalAccessUrl` now targets `{WEB_URL}/sites/{slug}/portal/access`)
   * plus its path+query, which is what the browser should actually open.
   *
   * WHY NOT `goto(mintedUrl)` DIRECTLY: the origin comes from the API's
   * `WEB_URL`, which on a PR preview is not the marketing preview this suite
   * targets. Navigating there would leave the deployment under test. Asserting
   * the path and opening it relative keeps both halves honest — a builder that
   * regresses to the old `/portal/{slug}/…` shape fails the assertion.
   */
  async mintMagicLink(
    leadId: string
  ): Promise<{ token: string; mintedUrl: string; accessPath: string }> {
    const minted = await readJson(
      `POST /patient-portal-access/${leadId}`,
      await this.api.post(`/patient-portal-access/${leadId}`)
    );
    const mintedUrl = (minted.json as { url?: string } | null)?.url;
    if (!mintedUrl) {
      throw new Error(
        `[PortalSeed] Staff mint returned no URL for lead ${leadId} ` +
          `(HTTP ${minted.status}): ${minted.body.slice(0, 300)}`
      );
    }
    const parsed = new URL(mintedUrl);
    const token = parsed.searchParams.get('token');
    if (!token) {
      throw new Error(
        `[PortalSeed] Minted portal URL carries no token: ${mintedUrl}`
      );
    }
    return {
      token,
      mintedUrl,
      accessPath: `${parsed.pathname}${parsed.search}`,
    };
  }
}

/**
 * Narrow the module-level `seed` a spec file assigns in `beforeAll`.
 *
 * Preferred over `seed!`: if the hook did not run (a gate skipped the group, a
 * beforeAll threw), this fails with a sentence naming the cause instead of a
 * `Cannot read properties of undefined` several frames away from the reason.
 */
export function requireSeed(seed: PortalSeed | undefined): PortalSeed {
  if (!seed) {
    throw new Error(
      '[PortalSeed] not initialised — beforeAll did not complete. ' +
        'Check the env gate and the seeding step above this failure.'
    );
  }
  return seed;
}

/**
 * Wait until every Astro island on the page has HYDRATED.
 *
 * Astro server-renders an island's markup inside `<astro-island ssr …>` and
 * removes the `ssr` attribute once its client runtime has hydrated it (see
 * `removeAttribute("ssr")` in the built island script). Until then the markup
 * is inert: inputs accept text, buttons accept clicks, and nothing is wired to
 * a handler.
 *
 * That is not theoretical. The portal sign-in spec failed for two runs, in two
 * different ways, from this one race:
 *
 *  - fill landed pre-hydration, React mounted with empty state, Continue
 *    submitted nothing → "Email is required".
 *  - the value was made to stick, but the Continue CLICK still landed on
 *    un-hydrated markup. The trace shows the island's JS loading and then no
 *    request-OTP call at all — a silent no-op that reads exactly like a broken
 *    sign-in.
 *
 * Waiting on the app's own hydration signal fixes both, and unlike a sleep it
 * cannot pass early or waste time on a fast machine.
 */
export async function waitForIslands(
  page: import('@playwright/test').Page,
  timeout = 20_000
): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('astro-island[ssr]').length === 0,
    undefined,
    { timeout }
  );
}

/**
 * Fill a field on an Astro island and make the value STICK.
 *
 * The portal sign-in form is a React island: Astro streams its markup, so the
 * input is present and fillable a beat before React hydrates and takes the
 * value under control. A `fill()` that lands in that window is discarded on
 * hydration, and the form then submits empty — which surfaced as "Email is
 * required" and a missing OTP step, looking for all the world like a broken
 * sign-in rather than a test racing the page.
 *
 * `waitForIslands` handles the ordering; the retry loop then covers the
 * remaining window where React has mounted but is still committing its first
 * controlled render. It cannot mask a genuinely broken field: if the value
 * never sticks, this fails.
 */
export async function fillHydrated(
  field: import('@playwright/test').Locator,
  value: string,
  expect: typeof import('@playwright/test').expect,
  timeout = 15_000
): Promise<void> {
  await waitForIslands(field.page());
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout });
}
