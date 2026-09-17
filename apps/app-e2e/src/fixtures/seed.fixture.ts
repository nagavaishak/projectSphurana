import { type APIRequestContext, type Page, expect } from '@playwright/test';
import { branchUrl } from './branch.fixture.js';
import { TEST_ASSETS_BASE_URL } from './test-assets.fixture.js';
import { isVisibleWithin } from './wait.js';

/**
 * Back-off between attempts of a retry/poll loop (sign-in retry, redirect
 * retry, batch polling). This is NOT a render race — there is no DOM condition
 * to wait on, we are pacing calls to a remote system — so a plain timer is the
 * right primitive (and `page.waitForTimeout` is banned suite-wide).
 */
const backOff = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const TEST_RUN_ID = Date.now();

export const API_URL = process.env.API_URL || 'http://localhost:3000';

/**
 * Sentinel prefix for the error thrown by `simulateAssistantMessage` when the
 * staging API has no Anthropic model key configured. Lets callers detect an
 * unavailable assistant backend and skip (rather than hard-fail) via
 * `skipIfAssistantUnavailable`.
 */
export const ASSISTANT_UNAVAILABLE = 'ASSISTANT_UNAVAILABLE';

/** The name `SeedHelper.ensureCampaign()` gives the campaign it seeds. */
export const E2E_CHATBOT_CAMPAIGN_NAME = 'E2E Leads Chatbot Campaign';

/** One entry of `GET /meta-campaigns`, as the E2E suite consumes it. */
export interface SeededCampaign {
  id: string;
  name: string;
  status: string;
  /**
   * Present only when THIS stack's database holds a `meta_campaign_config`
   * row for the campaign. The ad wizard keeps only campaigns that have one.
   */
  followUpType?: string | null;
}

/**
 * The ad wizard's own predicate, in one place.
 *
 * A campaign the suite may drive has to be BOTH ours by name and backed by a
 * local config — the campaign list comes from Meta's shared test ad account,
 * so a right-looking name proves nothing about this stack. See
 * `SeedHelper.ensureCampaign`.
 */
export const isE2EChatbotCampaign = (c: SeededCampaign): boolean =>
  c.followUpType === 'chatbot' && /^e2e[\s_-]/i.test(c.name);

const SEED_TOKEN = process.env.E2E_SEED_TOKEN;
if (!SEED_TOKEN) {
  throw new Error('E2E_SEED_TOKEN environment variable is required');
}

/**
 * Test data with unique identifiers per test run.
 * Email pattern `e2e.test.*` ensures cleanup via `/testing/cleanup`.
 */
export const TEST_DATA = {
  freshUser: {
    name: 'E2E Test User',
    email: `e2e.test.${TEST_RUN_ID}@example.com`,
    password: 'TestPassword123!',
  },
  secondUser: {
    name: 'E2E Second User',
    email: `e2e.test.second.${TEST_RUN_ID}@example.com`,
    password: 'TestPassword123!',
  },
  existingUser: {
    email: process.env.TEST_USER_EMAIL || 'test@example.com',
    password: process.env.TEST_USER_PASSWORD || 'testpassword123',
  },
  bareUser: {
    email: process.env.TEST_BARE_USER_EMAIL || 'test@example.com',
    password: process.env.TEST_BARE_USER_PASSWORD || 'testpassword123',
  },
  adminUser: {
    email: process.env.TEST_ADMIN_USER_EMAIL || '',
    password: process.env.TEST_ADMIN_USER_PASSWORD || '',
  },
  connectedUser: {
    email: process.env.TEST_CONNECTED_USER_EMAIL || '',
    password: process.env.TEST_CONNECTED_USER_PASSWORD || '',
  },
  metaPageId: process.env.TEST_META_PAGE_ID || '',
  // Meta Ads (Facebook) credentials for re-seeding the connected org's
  // meta_ads_integration row (never-expiring FLFB system-user token, immune
  // to Facebook password changes). When unset, seeding is skipped and the
  // connected org keeps whatever connection state is already in the DB.
  metaAds: {
    accessToken: process.env.TEST_META_ACCESS_TOKEN || '',
    adAccountId: process.env.TEST_META_AD_ACCOUNT_ID || '',
    adAccountName: process.env.TEST_META_AD_ACCOUNT_NAME || '',
    pageName: process.env.TEST_META_PAGE_NAME || '',
  },
  // WhatsApp Business credentials for seeding the connected org's
  // whatsapp_account row (real, ideally never-expiring system-user token).
  // When unset, the connected WhatsApp specs skip rather than fail.
  whatsapp: {
    accessToken: process.env.TEST_WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.TEST_WHATSAPP_PHONE_NUMBER_ID || '',
    wabaId: process.env.TEST_WHATSAPP_WABA_ID || '',
    phoneNumber: process.env.TEST_WHATSAPP_PHONE_NUMBER || '',
    displayName: process.env.TEST_WHATSAPP_DISPLAY_NAME || '',
  },
  // Real Stripe Connect account id (acct_…) for seeding the connected org's
  // stripe_connect_integration at the fixture level, so preview shows a
  // genuinely-connected org (no "Set up payments" → account-link 500). When
  // unset, the fixture-level Stripe seed is skipped (per-test seedStripeConnect
  // still fabricates ids for the specs that need them).
  stripeConnect: {
    accountId: process.env.TEST_STRIPE_CONNECT_ACCOUNT_ID || '',
  },
  organization: {
    name: `E2E Test Salon ${TEST_RUN_ID}`,
    businessType: 'salon',
    websiteUrl: 'https://example-salon.com',
  },
  lead: {
    firstName: `E2E Lead ${TEST_RUN_ID}`,
    email: `e2e.lead.${TEST_RUN_ID}@example.com`,
    phone: '+1234567890',
    source: 'manual',
  },
  socialPost: {
    caption: `E2E Test Post ${TEST_RUN_ID}`,
  },
  sequence: {
    name: `E2E Test Sequence ${TEST_RUN_ID}`,
  },
  cleanupPattern: 'e2e.test.%',
};

/**
 * Helper class for seeding and cleaning up E2E test data.
 *
 * Uses the backend `/testing/*` endpoints to:
 * - Get verification tokens (bypass email delivery)
 * - Force-verify users and organizations
 * - Clean up all test data matching `e2e.test.%` email pattern
 *
 * Uses the browser page to drive real UI flows for:
 * - Sign up, verify email, onboard
 */
export class SeedHelper {
  constructor(
    private page: Page,
    private request: APIRequestContext
  ) {}

  // ─── API Helpers (call testing endpoints) ────────────────────

  private get authHeaders() {
    return { Authorization: `Bearer ${SEED_TOKEN}` };
  }

  /**
   * Check that the testing endpoints are accessible.
   */
  async healthCheck(): Promise<boolean> {
    const response = await this.request.get(`${API_URL}/testing/health`, {
      headers: this.authHeaders,
    });
    return response.ok();
  }

  /**
   * Get the latest email verification token for a given email.
   * Used to bypass email delivery in tests.
   */
  async getVerificationToken(email: string): Promise<string> {
    const response = await this.request.get(
      `${API_URL}/testing/verification-token?email=${encodeURIComponent(email)}`,
      { headers: this.authHeaders }
    );
    const data = await response.json();
    if (!data.success) {
      throw new Error(`Failed to get verification token: ${data.message}`);
    }
    return data.token;
  }

  /**
   * Mint a retrievable patient-portal sign-in OTP (ENG-647). The emailed code is
   * hashed at rest, so — exactly like the reset-token helpers — E2E asks the
   * server for a fresh usable one. Requires the email to belong to an existing
   * lead at the org (the non-enumeration gate); throws otherwise.
   */
  async getPatientOtp(
    email: string,
    organizationSlug: string
  ): Promise<string> {
    const response = await this.request.post(`${API_URL}/testing/patient-otp`, {
      headers: this.authHeaders,
      data: { email, organizationSlug },
    });

    // Read the body as TEXT first, and keep the status.
    //
    // `response.json()` on its own turns an unhealthy preview API into
    // `SyntaxError: Unexpected token '<', "<!doctype "...` — the router served
    // the SPA shell because the API was down, and the reported error names
    // neither the status nor the endpoint. That is a materially misleading
    // failure: it reads as a bug in the caller rather than "the API returned
    // 502", and it cost a real debugging cycle on the ENG-647 portal specs.
    const body = await response.text();
    let data: { otp?: string; message?: string } = {};
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(
        `Failed to mint patient OTP for ${email} @ ${organizationSlug}: ` +
          `API returned ${response.status()} with a non-JSON body ` +
          `(likely down or restarting). First 200 chars: ${body.slice(0, 200)}`
      );
    }

    if (!data.otp) {
      throw new Error(
        `Failed to mint patient OTP for ${email} @ ${organizationSlug}: ` +
          `HTTP ${response.status()} — ${data.message ?? 'unknown'}`
      );
    }
    return data.otp;
  }

  /**
   * Get the latest password reset token for a given email.
   * Uses a dedicated endpoint that orders by createdAt desc to avoid returning
   * an older email verification token.
   */
  async getResetPasswordToken(email: string): Promise<string> {
    const response = await this.request.get(
      `${API_URL}/testing/reset-password-token?email=${encodeURIComponent(email)}`,
      { headers: this.authHeaders }
    );
    const data = await response.json();
    if (!data.success) {
      throw new Error(`Failed to get reset password token: ${data.message}`);
    }
    return data.token;
  }

  /**
   * Force-verify a user's email (set emailVerified = true).
   */
  async forceVerifyUser(email: string): Promise<void> {
    const response = await this.request.post(
      `${API_URL}/testing/force-verify`,
      {
        headers: this.authHeaders,
        data: { email },
      }
    );
    const data = await response.json();
    if (!data.success) {
      throw new Error(`Failed to force-verify user: ${data.message}`);
    }
  }

  // ─── Email Verification (via Testing API) ──────────────────

  /**
   * Verify a user's email using the testing API to get the verification token.
   * Polls for the token (auth server stores it asynchronously), then navigates
   * to the verification URL.
   */
  async verifyEmail(email: string): Promise<void> {
    // Poll for the verification token (auth server stores it in Redis asynchronously)
    let token: string | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        token = await this.getVerificationToken(email);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!token)
      throw new Error(`No verification token found for ${email} after 20s`);

    console.log(`[SeedHelper] Got verification token for ${email}`);
    const verifyUrl = `/verify-email?token=${token}`;
    await this.page.goto(verifyUrl, { waitUntil: 'domcontentloaded' });
    // Post-verify landing varies by deployment/onboarding state: sign-in (must
    // re-auth), dashboard (already onboarded), or the onboarding funnel — which
    // is served at both `/onboarding` and its entry `/welcome`.
    // Pathname only: `waitForURL` matches the whole href, and a Vercel preview
    // host carries the branch name — so on `feat/onboarding-cleanup` the host
    // alone satisfied /onboarding/ and this returned before anything happened.
    await this.page.waitForURL(
      (url) => /^\/(sign-in|dashboard|onboarding|welcome)/.test(url.pathname),
      { timeout: 15000, waitUntil: 'domcontentloaded' }
    );
    console.log(`[SeedHelper] Email verified for ${email}`);

    // Drop the session the verification flow left behind.
    //
    // That session was minted around the unverified user, and the API serves
    // sessions from a cache — so it can keep reporting `emailVerified: false`
    // after the row has flipped. `_onboarding`'s guard reads exactly that field
    // and bounces to /verify-email, which is where the onboarding journeys were
    // dying: the log said "Email verified", then several steps later the page
    // was back on "Check your email".
    //
    // Every caller signs in straight after (or clears cookies itself), so this
    // just forces that sign-in to be REAL rather than being skipped by the
    // "already signed in" shortcut — and a fresh sign-in mints a session that
    // knows the user is verified.
    await this.signOut();
  }

  /**
   * Get the password reset link using the testing API to get the reset token.
   * Returns the relative URL to navigate to.
   */
  async getResetLink(email: string): Promise<string> {
    // Better-auth persists the reset verification record to Redis asynchronously
    // after responding to /auth/forgot-password. On a cold backend or busy
    // worker, that can take significantly longer than 20s — pad the poll budget
    // so transient lag doesn't fail the test.
    let token: string | undefined;
    const maxAttempts = 20; // 20 × 2s = 40s
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        token = await this.getResetPasswordToken(email);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!token)
      throw new Error(
        `No reset token found for ${email} after ${maxAttempts * 2}s`
      );
    console.log(`[SeedHelper] Got reset token for ${email}`);
    return `/reset-password?token=${token}`;
  }

  /**
   * Sign up via API and verify email using testing API token.
   * Full flow: sign up via API → poll for verification token → navigate to verify URL.
   */
  async signUpAndVerify(userData: {
    name: string;
    email: string;
    password: string;
  }): Promise<void> {
    await this.signUpViaApi(userData);
    await this.verifyEmail(userData.email);
  }

  /**
   * Sign up a user via the API directly (bypasses Turnstile CAPTCHA).
   * Use this when CAPTCHA is flaky in headless mode.
   * The user is created with emailVerified=false; call verifyEmail() after.
   */
  async signUpViaApi(userData: {
    name: string;
    email: string;
    password: string;
  }): Promise<void> {
    // Retry once on transient 500 errors
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.request.post(`${API_URL}/auth/sign-up`, {
        data: {
          name: userData.name,
          email: userData.email,
          password: userData.password,
          // No captchaToken — server skips validation in non-production
        },
        timeout: 60_000, // Sign-up triggers email via Resend on staging
      });

      if (response.ok()) return;

      const body = await response.text();
      // 409 = user already exists, treat as success (idempotent)
      if (response.status() === 409) return;
      // Retry on 500
      if (response.status() >= 500 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw new Error(`API sign-up failed (${response.status()}): ${body}`);
    }
  }

  /**
   * Seed the platform admin the admin-terminal specs sign in as.
   *
   * The user id is NOT ours to choose: `GlobalAdminGuard` and Better Auth's
   * admin plugin both read ADMIN_USER_IDS, and the plugin captures it at
   * import, so only the server knows which id counts as an admin. The endpoint
   * hands back the TOTP secret so the spec can derive live codes and drive the
   * REAL verify-2fa gate instead of stubbing it.
   */
  async seedPlatformAdmin(input: {
    email: string;
    password: string;
  }): Promise<{ userId: string; email: string; totpSecret: string }> {
    const response = await this.request.post(
      `${API_URL}/testing/seed-platform-admin`,
      { headers: this.authHeaders, data: input }
    );
    if (!response.ok()) {
      throw new Error(
        `Failed to seed platform admin: ${response.status()} ${await response.text()}`
      );
    }
    return response.json();
  }

  /**
   * Force-verify an organization.
   */
  async forceVerifyOrganization(organizationId: string): Promise<void> {
    const response = await this.request.post(
      `${API_URL}/testing/force-verify-org`,
      {
        headers: this.authHeaders,
        data: { organizationId },
      }
    );
    const data = await response.json();
    if (!data.success) {
      throw new Error(`Failed to force-verify organization: ${data.message}`);
    }
  }

  /**
   * Create a verified organization for an existing user via the testing API,
   * making that user its owner. Returns the new organization id.
   *
   * The pure-API counterpart to driving the onboarding wizard — deterministic,
   * no UI, no Stripe/Loops side effects. Used by `createEmptyVerifiedOrg` and
   * (later) the connected per-test-org fixture.
   */
  async createOrg(input: {
    userId: string;
    name: string;
    businessType?: string;
  }): Promise<string> {
    const response = await this.request.post(`${API_URL}/testing/create-org`, {
      headers: this.authHeaders,
      data: input,
    });
    const data = await response.json();
    if (!data.success || !data.data?.organizationId) {
      throw new Error(`Failed to create organization: ${data.message}`);
    }
    return data.data.organizationId as string;
  }

  /**
   * Provision a fresh, verified, empty organization for a brand-new test user —
   * entirely via the testing API (no UI, no onboarding wizard).
   *
   * This is the foundation the connected per-test-org isolation plan needs
   * (apps/app-e2e/CONNECTED-ISOLATION.md): give each connected/targeting test
   * its own org so per-org state (chatbot targeting flags, settings) is private
   * to that test, instead of mutating one shared org. Each call mints a unique
   * `e2e.test.*` user so `/testing/cleanup` reaps it.
   *
   * Steps (all existing endpoints + the new create-org):
   *   1. sign up + verify the user's email (`signUpAndVerify`)
   *   2. resolve the user id (`createSession`)
   *   3. create the org with that user as owner (`createOrg`)
   *   4. mark the org verified (`forceVerifyOrganization`)
   *
   * Returns everything a fixture needs to seed integrations + build a
   * storageState: `{ orgId, userId, email, password, sessionToken }`.
   *
   * @param label - short slug folded into the email so failures are traceable
   *                to the originating test (e.g. the test title).
   */
  async createEmptyVerifiedOrg(
    label = 'org',
    userData?: { name?: string; businessType?: string }
  ): Promise<{
    orgId: string;
    userId: string;
    email: string;
    password: string;
    sessionToken: string;
  }> {
    // Cap the label so the local part stays within the RFC 5321 64-char limit.
    // Fixed parts are `e2e.test.` (9) + `.` (1) + `Date.now()` (13) = 23 chars,
    // leaving 41 for the label; cap at 40 (→ 63 total) and strip any trailing
    // `-` left by truncation. Long test titles used to blow past 64 chars, and
    // #639's sign-up validator (RFC 5321 local-part limit) rejects those as
    // `invalid_format`, so provisionOrg fails with "User not found".
    const safeLabel = label
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .slice(0, 40)
      .replace(/-+$/g, '');
    const email = `e2e.test.${safeLabel}.${Date.now()}@example.com`;
    const localPart = email.split('@')[0];
    if (localPart.length > 64) {
      throw new Error(
        `Generated email local part is ${localPart.length} chars, exceeding the RFC 5321 64-char limit ("${localPart}"). The test label folded into the email is too long — shorten the label passed to createEmptyVerifiedOrg().`
      );
    }
    const password = 'TestPassword123!';
    // The DISPLAY name deliberately does NOT carry the test title.
    //
    // It used to be `E2E ${label} User`, and `label` is `testInfo.title`. That
    // name renders in the sidebar's account button, so its accessible name
    // contained the words of the test — and a test called "clock in, take a
    // break, clock out, then edit the entry" made
    // `getByRole('button', { name: 'Clock out' })` match the ACCOUNT MENU as
    // well as the real control. `.first()` then clicked the menu, the mutation
    // never fired, and the failure surfaced fifteen seconds later as a missing
    // empty-state string. The same collision hit "Add team member".
    //
    // Traceability is unaffected: the EMAIL still carries `safeLabel`, which is
    // what teardown and log-grepping key on.
    const name = userData?.name ?? `E2E User ${Date.now()}`;

    // ONE server-side call: verified user + verified org + subscription + session.
    //
    // This used to be FOUR HTTP round trips from the runner (sign-up →
    // force-verify → create-session → create-org). Two of them hash a password —
    // the KDF is deliberately CPU-expensive — and ~26 workers run these
    // concurrently, so the API shed load as `API sign-up failed (500)`. Worse, the
    // gap between sign-up and sign-in was a genuine race: sign-in could run before
    // the new user was readable, giving `Invalid email or password` for a user we
    // had just created. A retry loop papered over it; it was the single biggest
    // source of flake in the tabs job (25 flaky in the last run) and none of it
    // was about anything under test.
    //
    // In-process, there is no gap to race and the KDF runs once. See
    // TestingService.provisionOrg.
    const response = await this.request.post(
      `${API_URL}/testing/provision-org`,
      {
        headers: this.authHeaders,
        data: {
          email,
          password,
          name,
          orgName: `E2E ${label} Org`,
          ...(userData?.businessType
            ? { businessType: userData.businessType }
            : {}),
        },
        // The API gates provisioning to a few at a time (the password KDF is
        // CPU-bound; ~26 workers would otherwise land ~30 at once and stall the
        // event loop). A call may therefore QUEUE behind others — waiting is the
        // intended behaviour, and far cheaper than the failures it replaces.
        timeout: 120_000,
      }
    );
    const body = (await response.json()) as {
      success: boolean;
      message?: string;
      data?: { userId: string; organizationId: string; sessionToken: string };
    };
    if (!body.success || !body.data) {
      throw new Error(
        `Failed to provision org for ${email}: ${body.message ?? response.status()}`
      );
    }
    const { userId, organizationId: orgId, sessionToken } = body.data;

    console.log(
      `[SeedHelper] createEmptyVerifiedOrg: org=${orgId}, user=${userId} (${email})`
    );

    return { orgId, userId, email, password, sessionToken };
  }

  /**
   * Ensure a FIXED-identity org exists (idempotent).
   *
   * Unlike createEmptyVerifiedOrg (which mints a unique throwaway email per
   * call), this provisions the long-lived shared fixtures — the bare and
   * connected users — by their STABLE email. `provision-org` is idempotent and
   * concurrency-safe server-side, so calling this on every setup run is a no-op
   * once the account exists. That is exactly what lets `preview-shared` be reset
   * (re-forked from main) and lazily re-seeded by the first preview run that
   * needs it, instead of relying on hand-built rows that live forever.
   *
   * Returns the organization id.
   */
  async ensureProvisionedOrg(input: {
    email: string;
    password: string;
    name: string;
    orgName: string;
    businessType?: string;
  }): Promise<string> {
    const response = await this.request.post(
      `${API_URL}/testing/provision-org`,
      {
        headers: this.authHeaders,
        data: {
          email: input.email,
          password: input.password,
          name: input.name,
          orgName: input.orgName,
          ...(input.businessType ? { businessType: input.businessType } : {}),
        },
        // Matches createEmptyVerifiedOrg: provisioning is gated + KDF-bound
        // server-side, so a call may queue behind others. Waiting is intended.
        timeout: 120_000,
      }
    );
    const body = (await response.json()) as {
      success: boolean;
      message?: string;
      data?: { userId: string; organizationId: string; sessionToken: string };
    };
    if (!body.success || !body.data) {
      throw new Error(
        `Failed to ensure org for ${input.email}: ${body.message ?? response.status()}`
      );
    }
    console.log(
      `[SeedHelper] ensureProvisionedOrg: ${input.email} -> org ${body.data.organizationId}`
    );
    return body.data.organizationId;
  }

  /**
   * Get the active organization ID from the current browser session.
   */
  async getActiveOrganizationId(): Promise<string | null> {
    const { orgId } = await this.getSessionInfo();
    return orgId;
  }

  /**
   * Force-create a subscription for an organization.
   * Bypasses Stripe checkout for E2E testing.
   */
  async forceCreateSubscription(organizationId: string): Promise<void> {
    // The tabs projects provision many isolated organizations concurrently.
    // Subscription upserts can briefly contend for preview's shared database
    // connection pool; retry only transient server failures. The endpoint is
    // idempotent (upsert by organization id), so repeating this cannot create
    // an additional subscription.
    const maxAttempts = 3;
    let failure = 'unknown error';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.request.post(
          `${API_URL}/testing/force-subscription`,
          {
            headers: this.authHeaders,
            data: { organizationId },
          }
        );
        const data = (await response.json().catch(() => null)) as {
          success?: boolean;
          message?: string;
        } | null;

        if (data?.success) return;

        failure = data?.message ?? `HTTP ${response.status()}`;
        if (response.status() < 500) break;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }

      if (attempt < maxAttempts - 1) {
        await backOff((attempt + 1) * 1_000);
      }
    }

    throw new Error(`Failed to create subscription: ${failure}`);
  }

  /**
   * Get the organization ID for a user by email (via DB lookup).
   * More reliable than session-based lookup after onboarding.
   */
  async getOrganizationByEmail(email: string): Promise<string | null> {
    const response = await this.request.get(
      `${API_URL}/testing/organization-by-email?email=${encodeURIComponent(email)}`,
      { headers: this.authHeaders }
    );
    const data = await response.json();
    return data.success ? (data.organizationId ?? null) : null;
  }

  /**
   * Delete all organizations for a user by email.
   * Resets the user to pre-onboarding state.
   */
  async deleteUserOrganizations(email: string): Promise<void> {
    const response = await this.request.post(
      `${API_URL}/testing/delete-user-orgs`,
      {
        headers: this.authHeaders,
        data: { email },
      }
    );
    const data = await response.json();
    if (!data.success) {
      throw new Error(`Failed to delete user organizations: ${data.message}`);
    }
    console.log(
      `[SeedHelper] Deleted orgs for ${email}: ${data.deleted?.organizations ?? 0}`
    );
  }

  /**
   * Clean up all test data matching the email pattern.
   * Default pattern matches all `e2e.test.*` emails.
   */
  async cleanup(pattern?: string): Promise<void> {
    const response = await this.request.post(`${API_URL}/testing/cleanup`, {
      headers: this.authHeaders,
      data: { pattern: pattern ?? TEST_DATA.cleanupPattern },
    });
    const data = await response.json();
    if (!data.success) {
      console.warn(`Cleanup warning: ${data.message}`);
    }
  }

  /**
   * Create a session via the testing API.
   * Returns the session token directly, bypassing browser-based auth.
   * Used for constructing storageState reliably.
   */
  async createSession(
    email: string,
    password: string
  ): Promise<{
    token: string;
    user: { id: string; email: string; name: string | null };
  }> {
    const response = await this.request.post(
      `${API_URL}/testing/create-session`,
      {
        headers: this.authHeaders,
        data: { email, password },
      }
    );
    const data = await response.json();
    if (!data.success) {
      throw new Error(`Failed to create session: ${data.message}`);
    }
    return { token: data.token, user: data.user };
  }

  // ─── Browser Helpers (drive real UI) ─────────────────────────

  /**
   * Sign up a new user via the real sign-up form.
   */
  async signUpUser(userData: {
    name: string;
    email: string;
    password: string;
  }): Promise<void> {
    await this.page.goto('/sign-up');

    // Dismiss cookie consent banner if present
    await this.dismissCookieConsent();

    // Fill name if field exists. `exact: true` avoids matching the
    // TanStack Router devtools button (aria-label "Open match details for
    // /verify-email" etc.) which would collide with /name/i / /email/i.
    const nameField = this.page.getByLabel('Name', { exact: true });
    if (await isVisibleWithin(nameField, 2000)) {
      await nameField.fill(userData.name);
    }

    await this.page.getByLabel('Email', { exact: true }).fill(userData.email);
    await this.page
      .getByLabel('Password', { exact: true })
      .fill(userData.password);

    // Fill confirm password if present
    const confirmPassword = this.page.getByLabel('Confirm Password', {
      exact: true,
    });
    if (await isVisibleWithin(confirmPassword, 1000)) {
      await confirmPassword.fill(userData.password);
    }

    // Wait for Turnstile CAPTCHA to complete (if present).
    // The submit button is disabled until the captcha token is in state, so
    // "enabled" IS the condition the old blind 500ms sleep was guessing at.
    const submitButton = this.page.getByRole('button', {
      name: /sign up|create account|register/i,
    });
    await expect(submitButton).toBeEnabled({ timeout: 30000 });

    await submitButton.click();

    // Wait for either redirect or error toast, with retry
    try {
      await this.page.waitForURL(
        (url) => /^\/(verify-email|dashboard|onboarding)/.test(url.pathname),
        { timeout: 30000, waitUntil: 'domcontentloaded' }
      );
    } catch {
      // If the page didn't navigate, the click might not have registered
      // or the form is showing an error. Try clicking again — under the SAME
      // enabled-gate as the first attempt. `force: true` here skipped every
      // actionability check, so a retry could "succeed" against a button that
      // was disabled mid-submit or covered by an error toast, and the failure
      // would then surface as the confusing waitForURL timeout below rather
      // than as "the button wasn't clickable".
      if (this.page.url().includes('sign-up')) {
        await expect(submitButton).toBeEnabled({ timeout: 10000 });
        await submitButton.click();
        await this.page.waitForURL(
          (url) => /^\/(verify-email|dashboard|onboarding)/.test(url.pathname),
          { timeout: 30000, waitUntil: 'domcontentloaded' }
        );
      }
    }
  }

  /**
   * Sign up via UI and verify email using testing API token.
   */
  async signUpAndVerifyViaUi(userData: {
    name: string;
    email: string;
    password: string;
  }): Promise<void> {
    await this.signUpUser(userData);

    // No sleep needed: verifyEmail() already polls the testing endpoint for the
    // token (10 × 2s) until the auth server has persisted it.
    await this.verifyEmail(userData.email);
  }

  /**
   * Email the browser is currently signed in as, or null when signed out.
   *
   * `page.request` shares the page context's cookie jar, so this is the same
   * session the SPA sees. Asking the API beats sniffing `page.url()`: /sign-in
   * bounces an authenticated user with a CLIENT-side redirect (its `beforeLoad`
   * → `getPostAuthRedirect`), so the URL right after `goto('/sign-in')` still
   * reads /sign-in for a moment even though the form will never mount.
   */
  private async currentSessionEmail(): Promise<string | null> {
    try {
      const response = await this.page.request.get(`${API_URL}/auth/session`);
      if (!response.ok()) return null;
      const data = (await response.json().catch(() => null)) as {
        user?: { email?: string };
      } | null;
      const email = data?.user?.email;
      return typeof email === 'string' ? email.toLowerCase() : null;
    } catch {
      return null;
    }
  }

  /**
   * Drop the browser's session completely.
   *
   * Cookies are only HALF of it. The app also persists a better-auth BEARER
   * token (`apps/app/src/lib/auth-token.ts` → secure-storage, which is
   * localStorage on web) and rehydrates it at startup, so a context with its
   * cookies cleared still boots authenticated: /sign-in then bounces straight
   * to /dashboard and its form never mounts. That is exactly how
   * `empty-state-sweep` ended up sweeping the dashboard as the SHARED bare user
   * instead of the fresh empty org it had just provisioned — it timed out
   * waiting for an Email field that was never going to render.
   */
  async signOut(): Promise<void> {
    await this.page.context().clearCookies();
    // localStorage is per-origin, so we must be ON the origin to clear it.
    if (new URL(this.page.url()).protocol === 'about:') {
      await this.page.goto('/sign-in');
    }
    await this.page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  }

  /**
   * Sign in an existing user via the real sign-in form.
   */
  async signInUser(email: string, password: string): Promise<void> {
    const signedInAs = await this.currentSessionEmail();

    // Already this user (e.g. verifyEmail just redirected them post-signup) —
    // nothing to do.
    if (signedInAs && signedInAs === email.toLowerCase()) {
      console.log(`[SeedHelper] Already signed in as ${email}, skipping`);
      return;
    }

    // Signed in as SOMEONE ELSE — typically the shared bare user injected by
    // the project's storageState, when a spec wants its own org's owner. Drop
    // the session first: /sign-in would otherwise redirect straight back out
    // and the test would silently run as the wrong user.
    if (signedInAs) {
      console.log(
        `[SeedHelper] Signed in as ${signedInAs}, clearing session to sign in as ${email}`
      );
      await this.signOut();
    }

    // Retry once on transient server errors (500s)
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.page.goto('/sign-in');

      // Dismiss cookie consent banner if present
      await this.dismissCookieConsent();

      // `exact: true` avoids matching the TanStack Router devtools button
      // (aria-label "Open match details for /verify-email") in dev mode.
      const emailField = this.page.getByLabel('Email', { exact: true });
      // On a cold Vite/tunnel the sign-in form can take >15s to hydrate; the
      // default action timeout then fails the fill before the field mounts.
      // Wait explicitly so a slow first render doesn't flake org provisioning.
      await emailField.waitFor({ state: 'visible', timeout: 30_000 });
      await emailField.fill(email);
      await this.page.getByLabel('Password', { exact: true }).fill(password);
      await this.page.getByRole('button', { name: /sign in|log in/i }).click();

      // Wait for either redirect or auth error
      // Use specific auth error patterns (not generic "error" which catches server 500 toasts)
      try {
        await Promise.race([
          // `/welcome` is kept only because it still resolves — it now
          // redirects to /onboarding, so a fresh signup lands there. The
          // session assertion below is what actually decides success.
          this.page.waitForURL(
            (url) =>
              /^\/(dashboard|welcome|onboarding|billing|verify-email|verify-2fa)/.test(
                url.pathname
              ),
            { timeout: 30000, waitUntil: 'domcontentloaded' }
          ),
          this.page
            .getByText(
              /invalid credentials|incorrect password|too many requests|rate limit|invalid email or password/i
            )
            .first()
            .waitFor({ timeout: 30000 })
            .then(() => {
              throw new Error(
                `Sign-in failed: auth error visible on page at ${this.page.url()}`
              );
            }),
        ]);

        // Landing on one of those URLs is necessary, NOT sufficient. Callers
        // immediately make cookie-authenticated API calls, and a "successful"
        // sign-in that left no usable session surfaces far away as an
        // unexplained 401 in whatever the caller does next. Confirm the session
        // is real and belongs to the user we asked for.
        // POLL, don't spot-check: the redirect can win the race against the
        // session being readable (cookie commit + the API's session store), so
        // a single immediate read reports "none" for a sign-in that is about to
        // be fine. Give it a few seconds before calling it a failure.
        let signedIn: string | null = null;
        const sessionDeadline = Date.now() + 10_000;
        do {
          signedIn = await this.currentSessionEmail();
          if (signedIn === email.toLowerCase()) return; // Success
          await backOff(500);
        } while (Date.now() < sessionDeadline);

        throw new Error(
          `Sign-in did not establish a session for ${email} within 10s (at ${this.page.url()}, session reports ${signedIn ?? 'none'})`
        );
      } catch (e) {
        // Retry the whole form on ANY non-final attempt, not just when an
        // "unexpected error" toast happens to be on screen.
        //
        // On previews the API is scaled to zero between test windows, so the
        // first `POST /api/nest/auth/sign-in` can hit a cold machine and die at
        // the network layer — the trace shows status -1, no Set-Cookie, and NO
        // toast. The page still redirects, so the old code saw no toast, did
        // not retry, and the session simply never existed.
        if (attempt === 0) {
          console.warn(
            `[SeedHelper] Sign-in attempt 1 did not take (${e instanceof Error ? e.message : String(e)}) — retrying`
          );
          await backOff(3000);
          continue;
        }
        throw e;
      }
    }
  }

  /**
   * Complete the full user setup: sign up + verify + sign in.
   * Returns after the user is signed in and ready.
   */
  async completeFullUserSetup(
    userData: { name: string; email: string; password: string },
    orgData?: { name: string; businessType: string; websiteUrl?: string }
  ): Promise<string | null> {
    // Sign up and verify via testing API. verifyEmail() polls for the token, so
    // no sleep is needed to let the backend persist it.
    await this.signUpUser(userData);
    await this.verifyEmail(userData.email);

    // Sign in (verification redirects to sign-in)
    await this.signInUser(userData.email, userData.password);

    // Complete onboarding if redirected there
    if (this.page.url().includes('onboarding') && orgData) {
      await this.completeOnboarding(orgData);
    }

    // Get org ID
    return this.getActiveOrganizationId();
  }

  /**
   * Complete the onboarding wizard.
   *
   * Actual flow: business-name → business-type → website-scanner → locations →
   * booking-system → opening-hours → credibility → /billing
   */
  async completeOnboarding(orgData: {
    name: string;
    businessType: string;
    websiteUrl?: string;
  }): Promise<void> {
    // Dismiss cookie consent banner if present (can block button clicks)
    await this.dismissCookieConsent();

    const clickContinue = async () => {
      const btn = this.page.getByRole('button', {
        name: /^continue$|^finish$|^complete setup$|^get started$|^skip$/i,
      });
      await btn.click();
    };

    /**
     * Did that Continue click end the wizard? The old code slept 500ms and then
     * read `page.url()` — a coin flip against the SPA router. `waitForURL`
     * waits on the real condition (a bounded 1.5s: it resolves instantly when
     * we're already there, and every subsequent step wait is web-first anyway).
     */
    const isDone = async () => {
      try {
        await this.page.waitForURL(
          (url) => /^\/(dashboard|billing)/.test(url.pathname),
          { timeout: 1500 }
        );
        return true;
      } catch {
        return false;
      }
    };

    // Wait for the first step to load (may show "loading" / "setting up" first)
    // If it redirects away from onboarding, bail out early
    try {
      await this.page
        .getByText("What's your business called?")
        .waitFor({ timeout: 30000 });
    } catch {
      // Check if we got redirected away from onboarding
      const url = this.page.url();
      if (url.includes('billing') || url.includes('dashboard')) {
        console.log(
          `[Onboarding] Redirected to ${url} before wizard loaded, skipping onboarding`
        );
        return;
      }
      throw new Error(
        `Onboarding first step never appeared. Current URL: ${url}`
      );
    }
    await this.page.getByLabel(/business name/i).fill(orgData.name);
    await clickContinue();
    if (await isDone()) return;

    // Step 2: Business type
    await this.page
      .getByText('What type of business do you run?')
      .waitFor({ timeout: 10000 });
    await this.page.getByLabel(/business type/i).click();
    // No sleeps: fill() and click() are web-first — they wait for the combobox
    // popover / filtered option to render.
    const searchInput = this.page.getByPlaceholder(/search business type/i);
    await searchInput.fill(orgData.businessType || 'salon');
    await this.page
      .getByRole('option', {
        name: new RegExp(orgData.businessType || 'salon', 'i'),
      })
      .first()
      .click();
    await clickContinue();
    if (await isDone()) return;

    // Step 3: Website analysis — skip
    await this.page.getByText('Enter your website').waitFor({ timeout: 10000 });
    await clickContinue();
    if (await isDone()) return;

    // Step 4: Locations — add a minimal location
    await this.page.getByText('Your Locations').waitFor({ timeout: 10000 });
    await this.page.getByRole('button', { name: /add a location/i }).click();
    const dialog = this.page.locator('[role="dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });

    // Switch to manual entry
    const manualEntry = dialog.getByText(/enter address manually/i);
    if (await isVisibleWithin(manualEntry, 2000)) {
      await manualEntry.click();
    }

    await dialog
      .getByPlaceholder('Street address *')
      .waitFor({ timeout: 5000 });
    await dialog.getByPlaceholder('Street address *').fill('123 Test St');
    await dialog.getByPlaceholder('City *').fill('Dublin');

    // Select country
    const countryBtn = dialog.getByRole('button', { name: /country/i });
    if (await isVisibleWithin(countryBtn, 1000)) {
      await countryBtn.click();
      await this.page.getByPlaceholder(/search country/i).fill('Ireland');
      await this.page
        .getByRole('option', { name: /ireland/i })
        .first()
        .click();
    }

    await dialog.getByRole('button', { name: /^add location$/i }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
    await clickContinue();
    if (await isDone()) return;

    // Step 5: Practitioners — skip (user is pre-populated)
    await this.page.getByText('Add Your Team').waitFor({ timeout: 10000 });
    await clickContinue();
    if (await isDone()) return;

    // Step 6: Booking system — use default
    await this.page
      .getByText('How do you handle bookings?')
      .waitFor({ timeout: 10000 });
    await clickContinue();
    if (await isDone()) return;

    // Step 7: Opening hours — use defaults (Mon-Fri 9-5)
    await this.page
      .getByText('Set your opening hours')
      .waitFor({ timeout: 10000 });
    await clickContinue();
    if (await isDone()) return;

    // Step 8: Credibility line (triggers org creation — can take 10+ seconds)
    await this.page
      .getByText('Choose one credibility line')
      .waitFor({ timeout: 10000 });
    const credibilityRadio = this.page.locator('#credibility-0');
    await credibilityRadio.click();
    await clickContinue();
    if (await isDone()) return;

    // Step 9: Owner provides services
    // The credibility step's onBeforeContinue creates the org, which can take time.
    // If it fails, we may still be on the credibility step — retry the click.
    await this.page
      .getByText('One last thing')
      .waitFor({ timeout: 30000 })
      .catch(async () => {
        // Org creation may have failed — try clicking Continue again. No sleep
        // after the click: the `waitFor('One last thing')` below is the real
        // condition and already allows 15s.
        const retryBtn = this.page.getByRole('button', { name: /^continue$/i });
        if (await isVisibleWithin(retryBtn, 2000)) {
          await retryBtn.click();
        }
      });
    await this.page.getByText('One last thing').waitFor({ timeout: 15000 });
    const completeBtn = this.page.getByRole('button', {
      name: /complete setup/i,
    });
    await completeBtn.click();

    // Onboarding submits straight to /billing — the per-service detail funnel
    // that used to sit in between is gone.
    await this.page.waitForURL(
      (url) => /^\/(billing|dashboard)/.test(url.pathname),
      { timeout: 60000, waitUntil: 'domcontentloaded' }
    );
  }

  // ─── UI Helpers ─────────────────────────────────────────────

  /**
   * No-op on apps/app. The Vite SPA doesn't render the cookie consent banner
   * that apps/web ships — kept as a method so ported tests that still call it
   * compile without churn.
   */
  async dismissCookieConsent(): Promise<void> {
    // apps/app has no cookie consent banner.
  }

  // ─── Session Helpers ─────────────────────────────────────────

  /**
   * Make an authenticated API call using the browser's session cookies.
   *
   * apps/app uses cookie-session auth on the web (see
   * `apps/app/src/lib/api-client.ts` — `authProvider` is undefined unless
   * `Capacitor.isNativePlatform()` is true). `page.request.fetch`
   * automatically shares the browser context's cookie jar.
   */
  // NOTE: deliberately does NOT set an Origin header. `page.request` sends no
  // Origin, which hits the API CORS layer's allowed `!origin` path. Setting one
  // from `page.url()` is unsafe — on about:blank it serialises to the string
  // "null", which CORS rejects with a 500 ("Origin null not allowed by CORS").
  async authenticatedApiCall(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    data?: unknown,
    suppressStatuses: number[] = []
  ): Promise<unknown> {
    const options: Parameters<APIRequestContext['fetch']>[1] = {
      method,
      // Without an explicit timeout, `page.request` inherits the config's
      // `actionTimeout` (15s). Under the bare suite's `--workers=8`, the shared
      // preview API gets hammered and a seed call can exceed 15s, which throws
      // `apiRequestContext.fetch: Timeout 15000ms` and cascades into
      // element-not-found failures. 60s gives transient lag plenty of room
      // without masking a genuinely dead backend. No retry: these calls are
      // non-idempotent (create lead/practitioner), so a retry could double-create.
      timeout: 60_000,
    };
    if (data) {
      options.data = data;
    }

    const response = await this.page.request.fetch(
      `${API_URL}${path}`,
      options
    );
    const json = await response.json();
    if (!response.ok() && !suppressStatuses.includes(response.status())) {
      console.warn(
        `[SeedHelper] ${method} ${path} failed (${response.status()}):`,
        JSON.stringify(json)
      );
    }
    return json;
  }

  // ─── Real E2E Helpers ──────────────────────────────────────

  /**
   * Create a practitioner via the real API and assert the created row came
   * back. Keys match `createPractitionerSchema` (name/email/title/phone).
   *
   * Global strict request validation is coming: keep these keys schema-clean so
   * an unknown field 400s rather than being silently dropped.
   */
  async createPractitioner(data: {
    name: string;
    email: string;
    title?: string;
    phone?: string;
  }): Promise<{ id: string; name: string; email: string }> {
    const created = (await this.authenticatedApiCall(
      'POST',
      '/practitioners',
      data
    )) as { id: string; name: string; email: string };
    expect(
      created.id,
      `createPractitioner did not return a row: ${JSON.stringify(created)}`
    ).toBeTruthy();
    expect(created.name).toBe(data.name);
    expect(created.email).toBe(data.email);
    return created;
  }

  /**
   * Give a practitioner explicit weekly shift coverage so booking availability
   * is deterministic regardless of which weekday CI runs on.
   *
   * Availability is derived SOLELY from `shift` rows (resolveAvailability has no
   * working-hours fallback), and create-practitioner only seeds a Mon–Fri
   * default. So a booking test that targets "in a week" — the SAME weekday as
   * today — finds zero slots whenever CI runs on a Saturday/Sunday. Seeding all
   * seven days makes slots guaranteed on any date.
   *
   * PUT /shifts/weekly/:practitionerId replaces the practitioner's recurring
   * weekly rows, so this cleanly supersedes the create-practitioner default.
   * Defaults to 09:00–18:00 (540–1080 min) every day.
   */
  async setWeeklyShifts(
    practitionerId: string,
    days: Array<{
      dayOfWeek: number;
      intervals: Array<{ startMinutes: number; endMinutes: number }>;
    }> = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      intervals: [{ startMinutes: 540, endMinutes: 1080 }],
    }))
  ): Promise<void> {
    const result = await this.authenticatedApiCall(
      'PUT',
      `/shifts/weekly/${practitionerId}`,
      { days }
    );
    // The controller returns the created rows on success; a Result-style
    // failure surfaces as { success: false }.
    if (!Array.isArray(result)) {
      throw new Error(
        `setWeeklyShifts(${practitionerId}) did not return shift rows: ${JSON.stringify(result)}`
      );
    }
  }

  /**
   * Assign services to a practitioner via the real API.
   */
  async assignPractitionerServices(
    practitionerId: string,
    serviceIds: string[]
  ): Promise<void> {
    await this.authenticatedApiCall(
      'PUT',
      `/practitioners/${practitionerId}/services`,
      { serviceIds }
    );
  }

  /**
   * Create an organization service via the real API and assert the row came
   * back with the fields we sent.
   *
   * IMPORTANT: field names MUST match `createServiceSchema`
   * (packages/features/src/organization-services/.../create-service.schema.ts).
   * The service has NO numeric `duration`/`price` columns — the bookable length
   * is `appointmentDuration` (minutes) and the price is the freeform
   * `priceText` string. Sending `{ duration, price }` used to be silently
   * stripped by the DTO's zod parse, so a "60-minute service" seed actually
   * persisted `appointmentDuration: null` and no test noticed (the response was
   * discarded). We now assert the persisted row so a silent strip fails the
   * seed immediately.
   *
   * Global strict request validation is coming: an unknown field will 400
   * rather than be dropped. Keep the keys here schema-clean so that lands green.
   */
  async createService(data: {
    name: string;
    category?: string;
    /** Bookable appointment length in minutes (schema: appointmentDuration). */
    appointmentDuration?: number;
    /** Freeform price label, e.g. "€50 per session" (schema: priceText). */
    priceText?: string;
    /** Machine-readable price in cents — the cart total sums these. */
    priceCents?: number;
  }): Promise<{
    id: string;
    name: string;
    category: string | null;
    appointmentDuration: number | null;
    priceText: string | null;
  }> {
    // Default a price when the caller doesn't set one. /billing no longer
    // bounces orgs with unpriced services (that gate and the /setup-services
    // funnel it fed are gone), but specs that assert on prices still want a
    // sane default, and leaving it keeps seeded data consistent across suites.
    // Any explicit price still wins.
    //
    // PRICING — read this before adding a price to a seed.
    //
    // `priceText` is DISPLAY ONLY. The API never parses it (create-service.service.ts:
    // priceType is inferred from priceCents — a bare priceCents → 'fixed', NONE →
    // 'poa'/€0). So a priceText-only seed persists a €0 POA service. That is the
    // CORRECT default here: the service stays unpriced without breaking specs
    // that don't care about price — and public-booking,
    // which exercises the FREE booking path (guest details → Confirm, no payment
    // step) — get the flow they expect.
    //
    // If your spec ASSERTS on a price (a cart total, a sale amount, a POS
    // remaining), you MUST pass `priceCents` (in cents: €30 → 3000). priceText
    // alone leaves the service at €0 and the failure surfaces far away and
    // silently — e.g. gift-card-redeem seeded `priceText: '€30'`, got a €0 sale,
    // so `remaining <= 0` → `isPaid` → the payment chooser never rendered and the
    // spec "couldn't find the Gift Card button". (There is deliberately NO guard
    // forcing this: a poa service with a display label is legitimate and common —
    // the default and ensureServicesPriced both rely on it — so priceText-without-
    // priceCents cannot be flagged without false-positiving real callers.)
    const payload = { priceText: '€50 per session', ...data };
    const created = (await this.authenticatedApiCall(
      'POST',
      '/organization-services',
      payload
    )) as {
      id: string;
      name: string;
      category: string | null;
      appointmentDuration: number | null;
      priceText: string | null;
    };

    // Fail loudly if the API rejected the payload (or returned an error shape)
    // instead of the created row.
    expect(
      created.id,
      `createService did not return a row: ${JSON.stringify(created)}`
    ).toBeTruthy();
    expect(created.name).toBe(data.name);
    if (data.category !== undefined) {
      expect(created.category).toBe(data.category);
    }
    // These are the fields the historic bug silently dropped — assert they
    // round-tripped so a schema drift can never again seed a null duration.
    if (data.appointmentDuration !== undefined) {
      expect(
        created.appointmentDuration,
        'appointmentDuration was not persisted — did the seed send a key the schema strips?'
      ).toBe(data.appointmentDuration);
    }
    if (data.priceText !== undefined) {
      expect(created.priceText).toBe(data.priceText);
    }

    return created;
  }

  /**
   * Add an OPTIONAL pricing variant to a service via the real API
   * (`POST /organization-services/:serviceId/variants`). A service that owns
   * variants forces the booking wizard to open a chooser so the customer picks
   * exactly one — and the chosen variant's price/duration/name are snapshotted
   * onto the appointment. See docs/plans/service-pricing-model.md.
   */
  async createServiceVariant(
    serviceId: string,
    data: {
      name: string;
      priceCents?: number | null;
      durationMinutes?: number | null;
      sortOrder?: number;
    }
  ): Promise<{ id: string; name: string; priceCents: number | null }> {
    const created = (await this.authenticatedApiCall(
      'POST',
      `/organization-services/${serviceId}/variants`,
      data
    )) as { id: string; name: string; priceCents: number | null };
    expect(
      created.id,
      `createServiceVariant did not return a row: ${JSON.stringify(created)}`
    ).toBeTruthy();
    expect(created.name).toBe(data.name);
    return created;
  }

  /**
   * List organization services via the real API.
   */
  async listServices(): Promise<
    Array<{
      id: string;
      name: string;
      category: string | null;
      priceText?: string | null;
    }>
  > {
    const result = (await this.authenticatedApiCall(
      'GET',
      '/organization-services'
    )) as
      | { items?: Array<{ id: string; name: string; category: string | null }> }
      | Array<{ id: string; name: string; category: string | null }>;
    return Array.isArray(result) ? result : (result.items ?? []);
  }

  /**
   * Guarantee the org's services are COMPLETE — that EVERY one carries a
   * `priceText`, and that there is at least one.
   *
   * HISTORY: /billing used to bounce an org to /setup-services when it had no
   * services **or when any single service was missing its price**, so an
   * ambient unpriced row could throw a subscribed user into the setup wizard
   * and fail the billing spec on a precondition no fixture owned. That gate and
   * the funnel are gone, so this is no longer load-bearing for /billing — it is
   * kept because specs that assert on prices depend on services being priced.
   *
   * Price what's there rather than adding to it: creating another service would
   * also collide by name on the second run (POST returns 409 on a duplicate
   * name), which is exactly how the first version of this helper broke setup.
   */
  /**
   * Guarantee the active org has at least one BRANCH.
   *
   * Since #927 a location is the unit of work: every branch-scoped surface is
   * addressed as `/dashboard/l/:branch/…`, and `branchUrl()` resolves that
   * handle from `GET /organization-locations`. An org with none answers
   * `200 []`, which is not an error anywhere — it just means no branch-scoped
   * URL can be built, so the suite navigated un-prefixed paths and the app's
   * compatibility splat sent them to `/dashboard/locations`. The mobile specs
   * then failed on a `toHaveURL` naming the picker, several steps from the
   * cause, and looked like flake because which specs reached it varied with
   * sharding.
   *
   * Idempotent in the way that matters here: it creates ONLY when the list
   * comes back empty, so a Playwright retry of the setup project, or a second
   * lane sharing this org, adds nothing. A 409 is swallowed for the same reason
   * `ensureServicesPriced` swallows it — a racing worker having already created
   * the branch means the goal is met.
   */
  async ensureBranchExists(): Promise<void> {
    const count = async (label: string): Promise<number> => {
      const body = (await this.authenticatedApiCall(
        'GET',
        '/organization-locations'
      )) as { items?: unknown[] } | unknown[] | null;
      // Shape-tolerant on purpose: this helper existed once already and did
      // nothing, because it assumed `{ items }` and never checked. Log what
      // actually came back so a wrong assumption cannot be silent twice.
      const items = Array.isArray(body) ? body : (body?.items ?? []);
      console.log(
        `[SeedHelper] ensureBranchExists(${label}): ${items.length} branch(es), keys=${
          Array.isArray(body) ? 'array' : Object.keys(body ?? {}).join(',')
        }`
      );
      return items.length;
    };

    if ((await count('before')) > 0) return;

    await this.authenticatedApiCall(
      'POST',
      '/organization-locations',
      {
        name: 'Main',
        addressLine1: '1 E2E Street',
        city: 'Dublin',
        country: 'ie',
        isPrimary: true,
      },
      // A racing worker having created it already is success, not failure.
      [409]
    );

    // PROVE it, do not assume it. `authenticatedApiCall` WARNS on a non-2xx
    // rather than throwing, so a rejected create would otherwise leave this
    // helper logging success while the org still has no branch — which is
    // exactly what happened on the first attempt at this fix.
    if ((await count('after')) === 0) {
      throw new Error(
        'setup-bare could not give the org a branch: POST /organization-locations ' +
          'left the list empty. Every branch-scoped URL depends on this, so the ' +
          'lane is failed here rather than in a spec that reports /dashboard/locations.'
      );
    }
  }

  async ensureServicesPriced(): Promise<void> {
    const existing = await this.listServices();

    const unpriced = existing.filter((s) => !s.priceText?.trim());
    for (const service of unpriced) {
      await this.authenticatedApiCall(
        'PUT',
        `/organization-services/${service.id}`,
        { priceText: '€50 per session' }
      );
    }

    if (existing.length === 0) {
      // Idempotent: setup-bare RETRIES (Playwright retries the setup project),
      // and `listServices()` returns [] whenever the active-org header isn't set
      // yet on a fresh session — so `existing.length === 0` is not a reliable
      // "no services" signal. On a retry (or a racing worker) the first attempt
      // already created this, and a second create 409s. A 409 "already exists"
      // means the goal — a priced service is present — is met, so swallow it;
      // anything else is a real failure.
      try {
        await this.createService({
          name: 'E2E Seed Service',
          category: 'treatment',
          appointmentDuration: 60,
          priceText: '€50 per session',
        });
      } catch (err) {
        if (!/already exists/i.test(String(err))) throw err;
      }
    }
  }

  /**
   * Create an offer via the real API and assert the created row came back.
   *
   * IMPORTANT: keys MUST match `createOfferBaseSchema`
   * (packages/features/src/offers/.../create-offer.schema.ts). The offer entity
   * has NO `headline`/`description`/`discountValue` — the previous shape sent
   * three keys the schema drops and omitted the REQUIRED `discountType`, so any
   * real use would have 400'd (or, pre-strict, silently persisted a malformed
   * offer). Discount fields are discriminated by `discountType`; this helper
   * defaults to a percentage discount.
   *
   * Global strict request validation is coming — keep these keys schema-clean.
   */
  async createOffer(data: {
    name: string;
    discountType?:
      | 'percentage'
      | 'fixed_amount'
      | 'fixed_price'
      | 'buy_x_get_y';
    discountPercent?: number;
    discountAmountCents?: number;
    originalPriceCents?: number;
    offerPriceCents?: number;
    buyQuantity?: number;
    getQuantity?: number;
  }): Promise<{ id: string; name: string }> {
    const discountType = data.discountType ?? 'percentage';
    const payload: Record<string, unknown> = { name: data.name, discountType };
    // Only the fields for the chosen discountType are required by the schema's
    // discriminator; default a percentage so the common case is valid.
    if (discountType === 'percentage') {
      payload.discountPercent = data.discountPercent ?? 10;
    }
    if (data.discountAmountCents !== undefined)
      payload.discountAmountCents = data.discountAmountCents;
    if (data.originalPriceCents !== undefined)
      payload.originalPriceCents = data.originalPriceCents;
    if (data.offerPriceCents !== undefined)
      payload.offerPriceCents = data.offerPriceCents;
    if (data.buyQuantity !== undefined) payload.buyQuantity = data.buyQuantity;
    if (data.getQuantity !== undefined) payload.getQuantity = data.getQuantity;

    const created = (await this.authenticatedApiCall(
      'POST',
      '/offers',
      payload
    )) as { id: string; name: string };
    expect(
      created.id,
      `createOffer did not return a row: ${JSON.stringify(created)}`
    ).toBeTruthy();
    expect(created.name).toBe(data.name);
    return created;
  }

  /**
   * A private, per-run copy of a shared public fixture — safe for an asset that
   * this spec will later DELETE.
   *
   * `DELETE /assets/:id` hard-deletes the S3 object behind the asset's
   * `blobUrl`. Several specs seeded an asset pointing straight at the SHARED
   * fixture and then deleted it in teardown, which deleted the fixture itself.
   * That is the mechanism behind an outage that was "fixed" twice by
   * re-uploading the object: `test-video.mp4` went first (every ad-launch spec
   * failed at publish with "Failed to download video from S3: HTTP 404"), then
   * `test-image.jpg` (three real-render specs failed with "E2E image fixture
   * must be reachable", nightly after nightly).
   *
   * So: if the asset you are seeding will be deleted, seed it from a clone.
   * Teardown then deletes the copy, and the fixture the whole suite depends on
   * is never in reach.
   */
  async cloneFixtureUrl(sourceUrl: string): Promise<string> {
    const response = await this.request.post(
      `${API_URL}/testing/clone-fixture`,
      {
        headers: this.authHeaders,
        data: { sourceUrl },
        timeout: 60_000,
      }
    );
    const result = (await response.json()) as {
      success?: boolean;
      message?: string;
      data?: { url?: string };
    };
    if (!result?.success || !result.data?.url) {
      throw new Error(
        `[SeedHelper] Could not clone fixture ${sourceUrl}: ${result?.message ?? `HTTP ${response.status()}`}`
      );
    }
    return result.data.url;
  }

  /**
   * Delete a service the way a test teardown means it: unlink its assets first,
   * then delete the row.
   *
   * `DELETE /organization-services/:id` answers 409 "Cannot delete service that
   * is linked to assets. Remove asset links first." That guard is correct
   * product behaviour — it exists so an owner cannot silently orphan the media
   * attached to a service. But every teardown that seeded a service AND linked
   * media to it (render-to-live-ad, create-graphic-dialog, image-generation)
   * called the bare DELETE, logged the 409 as a warning and moved on.
   *
   * The leak is not cosmetic. The connected suites share ONE organisation, so a
   * service that survives teardown is visible to every later spec — and it did
   * real damage: `service-inquiry.connected.spec.ts` asks Claire about
   * `services[0]`, which one night was a leaked `E2E Render-to-Ad Service` from
   * a suite that had already failed. Cleaning up properly here is what keeps
   * one suite's failure from becoming another suite's.
   *
   * Tolerant by design (404s suppressed, unlink failures non-fatal): this runs
   * in `finally` / `afterEach`, where the job is to leave the org clean, not to
   * introduce a second way for teardown to throw.
   */
  async deleteServiceWithLinkedAssets(serviceId: string): Promise<void> {
    try {
      const linked = (await this.authenticatedApiCall(
        'GET',
        `/assets/by-service/${serviceId}`,
        undefined,
        [404]
      )) as { items?: Array<{ id: string }> } | Array<{ id: string }> | null;

      const assets = Array.isArray(linked) ? linked : (linked?.items ?? []);
      for (const asset of assets) {
        await this.authenticatedApiCall(
          'DELETE',
          `/assets/${asset.id}/services`,
          { serviceIds: [serviceId] },
          [404]
        );
      }
      if (assets.length > 0) {
        console.log(
          `[SeedHelper] Unlinked ${assets.length} asset(s) from service ${serviceId} before delete`
        );
      }
    } catch (error) {
      // An unlink that fails still leaves the DELETE worth attempting — and its
      // 409 will name the real reason.
      console.warn(
        `[SeedHelper] Could not unlink assets from service ${serviceId}:`,
        error
      );
    }

    await this.authenticatedApiCall(
      'DELETE',
      `/organization-services/${serviceId}`,
      undefined,
      [404]
    );
  }

  /**
   * List organization assets via the real API.
   */
  async listAssets(
    type?: 'video' | 'image'
  ): Promise<
    Array<{ id: string; name: string; blobUrl: string; type: string }>
  > {
    const qs = type ? `?type=${type}` : '';
    const result = (await this.authenticatedApiCall('GET', `/assets${qs}`)) as
      | {
          items?: Array<{
            id: string;
            name: string;
            blobUrl: string;
            type: string;
          }>;
        }
      | Array<{ id: string; name: string; blobUrl: string; type: string }>;
    return Array.isArray(result) ? result : (result.items ?? []);
  }

  /**
   * Get a single asset's full details via the real API.
   */
  async getAsset(assetId: string): Promise<{
    id: string;
    name: string;
    blobUrl: string;
    thumbnailUrl: string | null;
    type: string;
    width: number | null;
    height: number | null;
    duration: number | null;
  }> {
    const result = (await this.authenticatedApiCall(
      'GET',
      `/assets/${assetId}`
    )) as {
      id: string;
      name: string;
      blobUrl: string;
      thumbnailUrl?: string | null;
      type: string;
      width?: number | null;
      height?: number | null;
      duration?: number | null;
    };
    return {
      id: result.id,
      name: result.name,
      blobUrl: result.blobUrl,
      thumbnailUrl: result.thumbnailUrl ?? null,
      type: result.type,
      width: result.width ?? null,
      height: result.height ?? null,
      duration: result.duration ?? null,
    };
  }

  /**
   * Poll until an asset has a non-null thumbnailUrl.
   * @param assetId - The asset ID to poll
   * @param timeoutMs - Max wait time (default: 2 minutes)
   */
  async waitForThumbnail(
    assetId: string,
    timeoutMs = 120_000
  ): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const asset = await this.getAsset(assetId);
      if (asset.thumbnailUrl) {
        return asset.thumbnailUrl;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(
      `Asset ${assetId} thumbnail was not generated within ${timeoutMs}ms`
    );
  }

  /**
   * Check that a URL is reachable (returns 2xx or 3xx).
   */
  async isUrlAccessible(url: string): Promise<boolean> {
    try {
      const response = await this.request.head(url, {
        timeout: 10_000,
        ignoreHTTPSErrors: true,
      });
      return response.status() >= 200 && response.status() < 400;
    } catch {
      return false;
    }
  }

  /**
   * Poll until a video reaches 'ready' status.
   * @param videoId - The video ID to poll
   * @param timeoutMs - Max wait time (default: 5 minutes)
   * @returns The video object with blobUrl
   */
  async waitForVideoReady(
    videoId: string,
    timeoutMs = 300_000,
    // Abort early when the job was never PICKED UP. The verdict below already
    // distinguishes "never left its first status" from "slow renderer" — but it
    // only reaches that conclusion after burning the whole `timeoutMs`, so a
    // known-dead queue costs the full 8 minutes to re-learn. `render-to-live-ad`
    // is quarantined on exactly that gap and was setting the advisory lane's
    // wall clock at ~8m46s, roughly double every required suite.
    //
    // OPT-IN, and deliberately not a default. Concluding "never picked up" from
    // 3 minutes of silence is only sound where a consumer is known to exist. In
    // e2e.yml every leg checks the worker's log for queue consumers first and
    // exports E2E_WORKER_QUEUE_VERIFIED when it finds them, so the inference
    // holds. It does NOT hold in e2e-nightly.yml's `real (billed renders)` job:
    // that runs real Gemini/Remotion behind `needs: connected-suite`, has no
    // equivalent preflight, and can meet a genuinely backlogged queue — where a
    // 3-minute bound would turn a slow-but-successful render into a false
    // "never picked up". Unset there, so the full `timeoutMs` applies.
    //
    // Pass a number to force it on regardless. Only trips while the status has
    // NEVER changed; once the pipeline is moving, `timeoutMs` governs.
    neverStartedMs = process.env.E2E_WORKER_QUEUE_VERIFIED === '1'
      ? 180_000
      : timeoutMs
  ): Promise<{ blobUrl: string }> {
    const start = Date.now();
    // Every status the video passed through, and when. On a timeout this IS
    // the diagnosis, and it is otherwise unrecoverable after the fact: the old
    // message said only "did not become ready", which cannot distinguish a job
    // the worker NEVER PICKED UP (stuck on its first status for the whole
    // window — a stopped or non-consuming preview worker) from one that is
    // simply rendering slower than the timeout. Those have opposite fixes, and
    // telling them apart meant reaching for Fly logs that have usually rotated
    // by the time anyone looks.
    const timeline: string[] = [];
    let lastStatus: string | undefined;

    while (Date.now() - start < timeoutMs) {
      const result = (await this.authenticatedApiCall(
        'GET',
        `/videos/${videoId}`
      )) as { status?: string; blobUrl?: string };

      if (result.status !== lastStatus) {
        lastStatus = result.status;
        timeline.push(`${result.status ?? 'unknown'}@${Date.now() - start}ms`);
      }

      if (result.status === 'ready' && result.blobUrl) {
        return { blobUrl: result.blobUrl };
      }
      if (result.status === 'failed') {
        throw new Error(
          `Video rendering failed for ${videoId} (statuses: ${timeline.join(' → ')})`
        );
      }
      if (
        timeline.length <= 1 &&
        Date.now() - start >= neverStartedMs &&
        neverStartedMs < timeoutMs
      ) {
        throw new Error(
          `Video ${videoId} never left "${lastStatus ?? 'unknown'}" after ${Math.round(neverStartedMs / 1000)}s, so the render job was never picked up — a stopped worker, or one not consuming the video-render queue — rather than a slow render. Failing now instead of waiting out the remaining ${Math.round((timeoutMs - neverStartedMs) / 1000)}s, which cannot change the diagnosis.`
        );
      }

      // Poll every 5 seconds
      await new Promise((r) => setTimeout(r, 5000));
    }

    const verdict =
      timeline.length <= 1
        ? `it never left "${lastStatus ?? 'unknown'}", so the render job was almost certainly never picked up — a stopped preview worker, or one not consuming the video-render queue — rather than a slow render`
        : 'it did progress, so the renderer is slow rather than absent';
    throw new Error(
      `Video ${videoId} did not become ready within ${timeoutMs}ms: ${verdict}. ` +
        `Statuses: ${timeline.join(' → ') || '(none observed)'}`
    );
  }

  /**
   * Poll `GET /assets/bulk-status` until every given asset's AI analysis has
   * settled as `completed`.
   *
   * Tagging runs in the background: the upload funnel gates on uploads only, so
   * a test that asserts on the model's classification has to wait on the
   * server-side status itself or it races the analysis queue. One request
   * covers the whole batch.
   *
   * Throws on a failed analysis or on timeout — a missing tag is a broken
   * pipeline, not a reason to pass.
   *
   * @param assetIds - Assets to watch (max 100, the endpoint's limit)
   * @param timeoutMs - Max wait (default 8 min, the analysis queue's tail)
   */
  async waitForAssetsAnalyzed(
    assetIds: string[],
    timeoutMs = 480_000
  ): Promise<void> {
    if (assetIds.length === 0) {
      throw new Error('waitForAssetsAnalyzed was called with no asset ids');
    }

    const start = Date.now();
    let lastSeen = '(no status observed)';

    while (Date.now() - start < timeoutMs) {
      let assets: Array<{
        id: string;
        name: string;
        analysisStatus: string | null;
      }> = [];

      try {
        const result = (await this.authenticatedApiCall(
          'GET',
          `/assets/bulk-status?assetIds=${encodeURIComponent(assetIds.join(','))}`
        )) as {
          assets?: Array<{
            id: string;
            name: string;
            analysisStatus: string | null;
          }>;
        };
        assets = result.assets ?? [];
      } catch {
        // A tunnel/gateway blip is not an analysis outcome — retry.
      }

      const failed = assets.filter((a) => a.analysisStatus === 'failed');
      if (failed.length > 0) {
        throw new Error(
          `Asset analysis failed for ${failed
            .map((a) => `${a.name} (${a.id})`)
            .join(', ')}`
        );
      }

      if (
        assets.length === assetIds.length &&
        assets.every((a) => a.analysisStatus === 'completed')
      ) {
        return;
      }

      if (assets.length > 0) {
        lastSeen = assets
          .map((a) => `${a.name}=${a.analysisStatus ?? 'pending'}`)
          .join(', ');
      }

      await new Promise((r) => setTimeout(r, 3000));
    }

    throw new Error(
      `Asset analysis did not complete within ${timeoutMs}ms. Last seen: ${lastSeen}`
    );
  }

  /**
   * Delete a Meta ad via the real API.
   */
  async deleteAd(adId: string): Promise<void> {
    await this.authenticatedApiCall('DELETE', `/meta-ads/${adId}`);
  }

  /**
   * Delete a Meta campaign via the real API.
   */
  async deleteCampaign(campaignId: string): Promise<void> {
    await this.authenticatedApiCall('DELETE', `/meta-campaigns/${campaignId}`);
  }

  /**
   * List all Meta campaigns via the real API.
   *
   * `followUpType` is part of the shape on purpose: it is the field the ad
   * wizard filters on (`use-campaign-step.ts` keeps only campaigns that have
   * one), and it is present ONLY when this stack's database holds a
   * `meta_campaign_config` row for the campaign. The list itself comes from
   * Meta — a SHARED ad account — so a campaign can be in it and still be
   * invisible to the wizard. Anything picking "the E2E campaign" must read
   * this, not just the name.
   */
  async listCampaigns(): Promise<SeededCampaign[]> {
    const result = (await this.authenticatedApiCall(
      'GET',
      '/meta-campaigns'
    )) as {
      campaigns?: SeededCampaign[];
    };
    return result.campaigns ?? [];
  }

  /**
   * List all Meta ads for a campaign via the real API.
   */
  async listAds(metaCampaignId: string): Promise<
    Array<{
      id: string;
      name: string;
      status: string;
      syncError?: string | null;
    }>
  > {
    const result = (await this.authenticatedApiCall(
      'GET',
      `/meta-ads/campaigns/${metaCampaignId}?limit=100`
    )) as {
      ads?: Array<{
        id: string;
        name: string;
        status: string;
        // `list-ads.service` has always returned this; the helper used to drop
        // it, which is why a failed launch and a stalled one looked identical.
        syncError?: string | null;
      }>;
    };
    return result.ads ?? [];
  }

  /**
   * Clean up all E2E campaigns and their ads.
   * Deletes any campaign whose name starts with "E2E" (case-insensitive).
   * Also deletes all ads under those campaigns.
   * Call this in setup to catch orphans from previous failed runs.
   */
  async cleanupE2ECampaignsAndAds(): Promise<void> {
    console.log('[SeedHelper] Cleaning up E2E campaigns and ads...');

    const campaigns = await this.listCampaigns();
    const e2eCampaigns = campaigns.filter((c) => /^e2e[\s_-]/i.test(c.name));

    if (e2eCampaigns.length === 0) {
      console.log('[SeedHelper] No E2E campaigns to clean up');
      return;
    }

    console.log(
      `[SeedHelper] Found ${e2eCampaigns.length} E2E campaign(s) to clean up`
    );

    for (const campaign of e2eCampaigns) {
      // Delete all ads under this campaign first
      try {
        const ads = await this.listAds(campaign.id);
        for (const ad of ads) {
          try {
            await this.deleteAd(ad.id);
            console.log(`[SeedHelper] Deleted ad "${ad.name}" (${ad.id})`);
          } catch (err) {
            console.warn(`[SeedHelper] Failed to delete ad ${ad.id}:`, err);
          }
        }
      } catch (err) {
        console.warn(
          `[SeedHelper] Failed to list ads for campaign ${campaign.id}:`,
          err
        );
      }

      // Delete the campaign
      try {
        await this.deleteCampaign(campaign.id);
        console.log(
          `[SeedHelper] Deleted campaign "${campaign.name}" (${campaign.id})`
        );
      } catch (err) {
        console.warn(
          `[SeedHelper] Failed to delete campaign ${campaign.id}:`,
          err
        );
      }
    }

    console.log('[SeedHelper] E2E campaign cleanup complete');
  }

  /**
   * List videos via the real API.
   */
  async listVideos(params?: {
    status?: string;
    limit?: number;
  }): Promise<Array<{ id: string; status: string; blobUrl?: string }>> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const qs = searchParams.toString();
    const result = (await this.authenticatedApiCall(
      'GET',
      `/videos${qs ? `?${qs}` : ''}`
    )) as
      | { items?: Array<{ id: string; status: string; blobUrl?: string }> }
      | Array<{ id: string; status: string; blobUrl?: string }>;
    return Array.isArray(result) ? result : (result.items ?? []);
  }

  // ─── Media Seeding Helpers ──────────────────────────────────────

  /**
   * The seeded video Meta is asked to ingest when an ad is launched.
   *
   * MUST be publicly downloadable: Meta fetches the URL from its own servers, so
   * a private or missing object surfaces as an opaque in-app dialog — "Failed to
   * launch ad / Failed to download video from S3: HTTP 404" — which reads like an
   * ads bug and is really a missing fixture.
   *
   * This pointed at `test-video.mp4`, which no longer exists in the bucket (404),
   * so EVERY ad-launch spec (launch-and-delete, launch-leads-chatbot, edit-ad,
   * render-to-live-ad) failed at publish. `procedure1.mp4` is restored from the
   * repository-owned fixture by `scripts/ensure-e2e-test-assets.sh` before the
   * connected suite runs. Keep that fixture and this key in sync.
   */
  private static readonly TEST_VIDEO_FILENAME = 'procedure1.mp4';

  /**
   * Get orgId and userId from the session in a single API call.
   */
  private async getSessionInfo(): Promise<{
    orgId: string | null;
    userId: string | null;
  }> {
    const result = (await this.authenticatedApiCall(
      'GET',
      '/auth/session'
    )) as {
      session?: {
        activeOrganizationId?: string;
        userId?: string;
      };
      user?: { id?: string };
    } | null;
    const orgId = result?.session?.activeOrganizationId ?? null;
    const userId = result?.session?.userId ?? result?.user?.id ?? null;
    console.log(
      `[SeedHelper] getSessionInfo: orgId=${orgId}, userId=${userId}`
    );
    return { orgId, userId };
  }

  /**
   * Read the better-auth session token from the browser context cookies.
   *
   * Pass the returned value to `simulateAssistantMessage({ sessionToken })` so
   * tools the model calls via `apiFetch` (anything behind the AuthGuard) run
   * with the same session the browser holds. Without it, those internal hops
   * are unauthenticated and throw "Authentication required".
   */
  async getSessionToken(): Promise<string | null> {
    const cookies = await this.page.context().cookies();
    const sessionCookie = cookies.find(
      (c) => c.name === '__Secure-better-auth.session_token'
    );
    return sessionCookie?.value ?? null;
  }

  /**
   * Ensure a "Created Video" (status='ready') exists in the org, pointing at a
   * blobUrl that Meta can actually download.
   *
   * This used to bail out early when the org already had ANY ready video, which
   * made the seed a one-shot: the row seeded by the first-ever run kept its
   * original blobUrl forever. When that object was deleted from the bucket,
   * every ad-launch spec started failing with an opaque in-app "Failed to
   * download video from S3: HTTP 404" — and re-running the seed could not fix
   * it, because the seed refused to run. /testing/seed-video is an upsert on a
   * deterministic id, so just call it: idempotent means CONVERGED, not frozen.
   */
  async ensureCreatedVideo(): Promise<string | null> {
    const { orgId, userId } = await this.getSessionInfo();
    if (!orgId || !userId) {
      console.warn(
        '[SeedHelper] Could not determine orgId/userId for video seed'
      );
      return null;
    }

    const blobUrl = `${TEST_ASSETS_BASE_URL}/${SeedHelper.TEST_VIDEO_FILENAME}`;
    const response = await this.request.post(`${API_URL}/testing/seed-video`, {
      headers: this.authHeaders,
      data: {
        organizationId: orgId,
        createdById: userId,
        title: 'E2E Seed Video',
        blobUrl,
      },
    });
    const result = (await response.json()) as {
      success?: boolean;
      message?: string;
      data?: { videoId?: string };
    };
    if (!result.success) {
      console.warn(`[SeedHelper] Failed to seed video: ${result.message}`);
      return null;
    }
    // Returned so a caller can address THIS video rather than guessing at the
    // list. The id is deterministic (`e2e-seed-created-video-<orgId>`), but
    // reading it off the response keeps that shape the API's business.
    return result.data?.videoId ?? null;
  }

  /**
   * Ensure an uploaded video asset exists in the org, pointing at a blobUrl
   * that is actually in the bucket. Upserts on a deterministic id — see
   * `ensureCreatedVideo` for why this must not short-circuit on "one already
   * exists".
   */
  async ensureUploadedVideo(): Promise<void> {
    const { orgId, userId } = await this.getSessionInfo();
    if (!orgId || !userId) {
      console.warn(
        '[SeedHelper] Could not determine orgId/userId for asset seed'
      );
      return;
    }

    const blobUrl = `${TEST_ASSETS_BASE_URL}/${SeedHelper.TEST_VIDEO_FILENAME}`;
    const response = await this.request.post(`${API_URL}/testing/seed-asset`, {
      headers: this.authHeaders,
      data: {
        organizationId: orgId,
        uploadedById: userId,
        name: 'E2E Seed Video Asset',
        blobUrl,
      },
    });
    const result = await response.json();
    if (!result.success) {
      console.warn(`[SeedHelper] Failed to seed asset: ${result.message}`);
    }
  }

  /**
   * Ensure one render-ready video asset exists AND is tagged so every
   * create-video template's media step finds usable footage.
   *
   * Each template's media slots filter by `clipGuidance.filterTag` (see
   * packages/features/src/videos/templates/template-definitions.ts —
   * `procedure`, `environment`, `before`, `after`, `before-after`). An
   * untagged asset surfaces under none of those filters, so a template's media
   * step finds nothing to select and the flow dead-ends at "required media not
   * available" — which is exactly the kind of missing precondition a spec must
   * SEED rather than skip on.
   *
   * Seeds via /testing/seed-asset (source='edited', transcodeStatus='skipped'
   * → usable by the render pipeline without the probe/transcode worker), then
   * replaces its tags with the full filterTag union via the session-auth
   * PUT /assets/:id/tags. Idempotent — safe to call on every run.
   */
  async ensureTaggedVideoAsset(): Promise<void> {
    const { orgId, userId } = await this.getSessionInfo();
    if (!orgId || !userId) {
      console.warn(
        '[SeedHelper] Could not determine orgId/userId for tagged-asset seed'
      );
      return;
    }

    const blobUrl = `${TEST_ASSETS_BASE_URL}/${SeedHelper.TEST_VIDEO_FILENAME}`;
    const response = await this.request.post(`${API_URL}/testing/seed-asset`, {
      headers: this.authHeaders,
      data: {
        organizationId: orgId,
        uploadedById: userId,
        name: 'E2E Seed Video Asset',
        blobUrl,
      },
    });
    const result = await response.json();
    const assetId = result?.data?.assetId as string | undefined;
    if (!result?.success || !assetId) {
      console.warn(
        `[SeedHelper] Failed to seed asset: ${result?.message ?? 'unknown error'}`
      );
      return;
    }

    // Union of every filterTag the create-video templates use, so this one
    // asset surfaces in every slot's tag-filtered media step (generic b-roll
    // plus before-after's before/after slots).
    const templateFilterTags = [
      'procedure',
      'environment',
      'before-after',
      'before',
      'after',
      'background',
    ];
    await this.authenticatedApiCall('PUT', `/assets/${assetId}/tags`, {
      tags: templateFilterTags,
    });
    console.log(
      `[SeedHelper] Tagged seed asset ${assetId}: ${templateFilterTags.join(', ')}`
    );
  }

  /**
   * Ensure one *raw* uploaded clip exists, tagged and linked to `serviceId`,
   * so the create-post wizard's "Choose your footage" step has something to
   * show.
   *
   * ensureTaggedVideoAsset seeds source='edited' for the render pipeline, but
   * the footage picker lists raw uploads only (buildUploadedVideoLibrary
   * filters `source === 'raw'`), so an edited seed leaves it empty. This seeds
   * source='raw' — a distinct asset ID, so both coexist.
   *
   * Tags are *replaced* (not merged) with `tags` so the clip carries exactly
   * the tags asked for: a spec asserting that some other tag matches nothing
   * needs the clip to be absent from that filter.
   *
   * Idempotent — safe to call on every run. The name is fixed rather than
   * unique-per-run because the underlying seed reuses one row per org+source
   * (onConflictDoNothing never rewrites the name), so the true stored name is
   * read back and returned.
   */
  async ensureRawFootageAsset(options: {
    serviceId: string;
    tags?: string[];
  }): Promise<{ assetId: string; name: string }> {
    const { orgId, userId } = await this.getSessionInfo();
    if (!orgId || !userId) {
      throw new Error(
        '[SeedHelper] Could not determine orgId/userId for raw-footage seed'
      );
    }

    // TEST_VIDEO_FILENAME, not a hand-typed name: `test-video.mp4` is gone from
    // the bucket (403), so a clip seeded with it renders-fails the moment the
    // wizard auto-selects it. See the TEST_VIDEO_FILENAME doc comment.
    const blobUrl = `${TEST_ASSETS_BASE_URL}/${SeedHelper.TEST_VIDEO_FILENAME}`;
    const response = await this.request.post(`${API_URL}/testing/seed-asset`, {
      headers: this.authHeaders,
      data: {
        organizationId: orgId,
        uploadedById: userId,
        name: 'E2E Raw Footage Clip',
        blobUrl,
        source: 'raw',
      },
    });
    const result = await response.json();
    const assetId = result?.data?.assetId as string | undefined;
    if (!result?.success || !assetId) {
      throw new Error(
        `[SeedHelper] Failed to seed raw asset: ${result?.message ?? 'unknown error'}`
      );
    }

    await this.authenticatedApiCall('PUT', `/assets/${assetId}/tags`, {
      tags: options.tags ?? ['procedure'],
    });
    await this.authenticatedApiCall('POST', `/assets/${assetId}/services`, {
      serviceIds: [options.serviceId],
    });

    const { name } = await this.getAsset(assetId);
    console.log(
      `[SeedHelper] Raw footage asset ${assetId} ("${name}") tagged ${(options.tags ?? ['procedure']).join(', ')}, linked to service ${options.serviceId}`
    );
    return { assetId, name };
  }

  // ─── Campaign Seeding ──────────────────────────────────────

  /**
   * Ensure an E2E chatbot campaign the ad wizard can actually drive exists,
   * and return it. Idempotent — reuses one when this org already has one.
   *
   * The NAME IS LOAD-BEARING: `src/ads/launch-leads-chatbot-ad.connected.spec.ts`
   * selects its campaign by name. Keep the `E2E ` prefix too — the cleanup
   * reaper matches /^e2e[\s_-]/i.
   *
   * MATCHING ON THE NAME ALONE IS NOT ENOUGH. The campaign list is Meta's, and
   * the test ad account is shared by every stack; in preview the fake's object
   * graph was shared too. A concurrent run's cleanup deleted this org's
   * campaign and seeded its own under the same name, so the list held a
   * campaign that looked right and had no `meta_campaign_config` row here.
   * `ensureCampaign` said "already exists", seeded nothing, and the wizard —
   * which keeps only campaigns WITH a `followUpType` — rendered "No campaigns
   * created yet". Two specs failed on it (run 32467004529). So match the
   * wizard's own predicate: chatbot follow-up, E2E name.
   */
  async ensureCampaign(): Promise<SeededCampaign> {
    const campaigns = await this.listCampaigns();
    const existing = campaigns.find(isE2EChatbotCampaign);
    if (existing) {
      console.log(
        `[SeedHelper] E2E chatbot campaign already exists: "${existing.name}" (${existing.id}), skipping seed`
      );
      return existing;
    }

    // Throws rather than warns: every caller hard-fails on a missing campaign
    // anyway, and an org that cannot hold one IS the regression.
    const result = (await this.authenticatedApiCall('POST', '/meta-campaigns', {
      name: E2E_CHATBOT_CAMPAIGN_NAME,
      objective: 'OUTCOME_LEADS',
      dailyBudget: 500, // $5/day in cents — campaign starts PAUSED so no spend
      followUpType: 'chatbot',
      targeting: {
        countries: ['IE'],
      },
    })) as { metaCampaignId?: string };
    console.log(`[SeedHelper] Campaign seeded: ${result.metaCampaignId}`);

    // Read it back through the same list the wizard uses, so a create that
    // wrote the Meta object but not the local config fails HERE, loudly,
    // instead of as an empty campaign step three steps later.
    const after = await this.listCampaigns();
    const created =
      after.find(
        (c) => c.id === result.metaCampaignId && isE2EChatbotCampaign(c)
      ) ?? after.find(isE2EChatbotCampaign);
    if (!created) {
      throw new Error(
        `[SeedHelper] ensureCampaign(): POST /meta-campaigns returned ${result.metaCampaignId ?? '(no id)'} but no chatbot campaign came back from GET /meta-campaigns. Campaigns now: ${after.map((c) => `${c.name} [${c.id}] followUpType=${c.followUpType ?? 'none'}`).join(', ') || '(none)'}. A campaign listed WITHOUT a followUpType has no meta_campaign_config row in this stack's database — the ad wizard filters those out.`
      );
    }
    return created;
  }

  /**
   * Seed or refresh the connected org's Meta Ads integration from CI secrets.
   * This is a direct DB upsert through /testing/seed-meta-ads, not a live Meta
   * API call, so it can run before every connected suite invocation. The
   * follow-up campaign seed still validates the token through Meta.
   */
  // ─── Chatbot E2E Helpers ──────────────────────────────────────

  /**
   * Ensure the chatbot is enabled for a specific Meta Ads page.
   * Should be called before webhook tests to guarantee the chatbot will process messages.
   */
  async ensureChatbotEnabled(pageId: string): Promise<void> {
    const response = await this.request.post(
      `${API_URL}/testing/ensure-chatbot-enabled`,
      {
        headers: this.authHeaders,
        data: { pageId },
      }
    );
    const result = await response.json();
    if (!result.success) {
      throw new Error(`Failed to ensure chatbot enabled: ${result.message}`);
    }
  }

  /**
   * Simulate a webhook by calling handleIncomingMessage via the testing endpoint.
   * Used for chatbot E2E tests since Meta has no API for sending messages AS a user.
   */
  async simulateWebhook(data: {
    platform: 'facebook_messenger' | 'instagram_dm' | 'whatsapp';
    pageId: string;
    senderId: string;
    messageText: string;
    queueDelayMs?: number;
    adReferral?: { metaAdId: string; source?: string; adTitle?: string };
  }): Promise<{ conversationId: string; messageId: string }> {
    const response = await this.request.post(
      `${API_URL}/testing/simulate-webhook`,
      {
        headers: this.authHeaders,
        data,
      }
    );
    const result = await response.json();
    if (!result.success) {
      throw new Error(`Failed to simulate webhook: ${result.message}`);
    }
    return {
      conversationId: result.conversationId,
      messageId: result.messageId,
    };
  }

  /**
   * Inject a Stripe Connect webhook event (no signature verification) so a spec
   * can settle card/QR/deposit/subscription/refund tenders deterministically.
   * Mirrors POST /testing/simulate-stripe-webhook. Requires STRIPE_E2E_STUB on
   * the target API (see STRIPE-TIER.md).
   */
  async simulateStripeWebhook(data: {
    eventType:
      | 'checkout.session.completed'
      | 'checkout.session.expired'
      | 'payment_intent.succeeded'
      | 'payment_intent.payment_failed'
      | 'charge.refunded'
      | 'account.updated'
      | 'customer.subscription.updated'
      | 'customer.subscription.deleted';
    metadata?: Record<string, string>;
    paymentIntentId?: string;
    checkoutSessionId?: string;
    amountRefundedCents?: number;
    amountCapturedCents?: number;
    stripeAccountId?: string;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
    detailsSubmitted?: boolean;
    stripeSubscriptionId?: string;
    stripeStatus?: string;
    currentPeriodEndSec?: number;
  }): Promise<{ received: boolean; processed: boolean; action: string }> {
    const response = await this.request.post(
      `${API_URL}/testing/simulate-stripe-webhook`,
      { headers: this.authHeaders, data }
    );
    const result = await response.json();
    return {
      received: result.received ?? false,
      processed: result.processed ?? false,
      action: result.action ?? 'unknown',
    };
  }

  /**
   * Seed a Stripe Connect integration for an org so Stripe-backed tenders find
   * an active connected account (with STRIPE_E2E_STUB on). Returns the fake
   * `acct_e2e_*` id. Flags default enabled; seed incomplete (e.g.
   * `detailsSubmitted: false`) to test the onboarding-completion flow.
   */
  async seedStripeConnect(data: {
    organizationId: string;
    stripeAccountId?: string;
    defaultCurrency?: string;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
    detailsSubmitted?: boolean;
    isActive?: boolean;
  }): Promise<{ stripeAccountId: string }> {
    const response = await this.request.post(
      `${API_URL}/testing/seed-stripe-connect`,
      { headers: this.authHeaders, data }
    );
    const result = await response.json();
    if (!result.success) {
      throw new Error(`Failed to seed stripe connect: ${result.message}`);
    }
    return { stripeAccountId: result.stripeAccountId };
  }

  /**
   * Seed the connected org's Stripe Connect integration from a REAL connected
   * account id (acct_…) via POST /testing/seed-stripe-connect.
   *
   * Mirrors seedConnectedMetaAdsIntegration: an idempotent DB upsert (no Stripe
   * API calls) run on every connected setup so the shared connected org shows as
   * genuinely connected — charges/payouts enabled, details submitted — instead
   * of routing a human in preview into "Set up payments" → POST account-link,
   * which 500s under STRIPE_E2E_STUB (the onboarding calls are not stubbed).
   *
   * No-op (returns false) when TEST_STRIPE_CONNECT_ACCOUNT_ID is unset.
   *
   * NOTE: the embedded balances/payouts (account-session) still make a LIVE
   * Stripe call, so under the preview stub they fall back rather than render —
   * seeding fixes the account-link 500 and the Active status, not the embedded
   * widget. Real embedded rendering needs real Stripe keys in preview.
   */
  async seedConnectedStripeConnect(): Promise<boolean> {
    const { accountId } = TEST_DATA.stripeConnect;
    if (!accountId) {
      console.warn(
        '[SeedHelper] Skipping Stripe Connect seed — TEST_STRIPE_CONNECT_ACCOUNT_ID not set.'
      );
      return false;
    }

    const { orgId } = await this.getSessionInfo();
    if (!orgId) {
      throw new Error(
        '[SeedHelper] Cannot seed Stripe Connect — no active org in session.'
      );
    }

    await this.seedStripeConnect({
      organizationId: orgId,
      stripeAccountId: accountId,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      isActive: true,
    });
    console.log(
      `[SeedHelper] Seeded Stripe Connect for org ${orgId} (${accountId})`
    );
    return true;
  }

  /**
   * Look up the org's open sale + payment rows so a spec can inject a Stripe
   * settlement webhook for an async tender (QR / terminal / deposit) by its
   * `salePaymentId`. Mirrors GET /testing/open-sale.
   */
  async getOpenSale(organizationId: string): Promise<{
    saleId: string;
    currency: string;
    payments: Array<{
      id: string;
      method: string;
      status: string;
      amountCents: number;
      stripePaymentIntentId: string | null;
    }>;
  }> {
    const response = await this.request.get(
      `${API_URL}/testing/open-sale?organizationId=${encodeURIComponent(organizationId)}`,
      { headers: this.authHeaders }
    );
    const result = await response.json();
    if (!result.success) {
      throw new Error(`Failed to get open sale: ${result.message}`);
    }
    return {
      saleId: result.saleId,
      currency: result.currency,
      payments: result.payments,
    };
  }

  /**
   * Simulate an assistant (Claire) chat message via the testing endpoint.
   *
   * The assistant analogue of `simulateWebhook` — runs one Claire turn
   * headlessly (no SSE) and returns the assistant text plus the tool-call
   * trace. `forceSkillIds` bypasses the first-turn LLM intent router so a
   * test can target one skill's tools deterministically.
   *
   * The model is still invoked for real (tool-argument generation is
   * non-deterministic). Assert on the SHAPE of the result (which tool fired,
   * a row created for the org), not exact wording.
   *
   * Pass `sessionToken` when the exercised tool calls back into the API via
   * apiFetch (e.g. createService, createLead). Tools that write directly via
   * `db` (e.g. `meta_remember`) don't need it.
   */
  async simulateAssistantMessage(data: {
    organizationId: string;
    userId: string;
    messageText: string;
    conversationId?: string;
    forceSkillIds?: string[];
    sessionToken?: string;
  }): Promise<{
    conversationId: string;
    assistantText: string;
    toolCalls: Array<{
      name: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
    }>;
  }> {
    const response = await this.request.post(
      `${API_URL}/testing/simulate-assistant-message`,
      {
        headers: this.authHeaders,
        data,
        timeout: 120_000,
      }
    );
    const result = await response.json();
    if (!result.success) {
      const message: string = result.message ?? '';
      // The assistant turn calls the real Anthropic model server-side. On
      // environments where the API has no model key (e.g. a freshly
      // provisioned staging API), the endpoint reports "Anthropic API key not
      // configured". That's an unavailable external dependency, not a test
      // defect — surface it as a recognizable sentinel so callers can skip
      // (mirrors the conditional-skip pattern for Meta/WhatsApp).
      if (/anthropic api key not configured/i.test(message)) {
        throw new Error(`${ASSISTANT_UNAVAILABLE}: ${message}`);
      }
      throw new Error(`Failed to simulate assistant message: ${message}`);
    }
    return {
      conversationId: result.conversationId,
      assistantText: result.assistantText ?? '',
      toolCalls: result.toolCalls ?? [],
    };
  }

  /**
   * Seed a valid WhatsApp Business connection for the current session's org
   * via POST /testing/seed-whatsapp. Mirrors the Meta seed pattern: writes a
   * whatsapp_account row directly from a provided (ideally never-expiring
   * system-user) token, bypassing the Embedded Signup flow the connected test
   * org can no longer complete. Idempotent.
   *
   * Returns false (no-op) when the TEST_WHATSAPP_* env vars are not configured,
   * so local runs without WhatsApp creds don't fail — the connected WhatsApp
   * specs guard on `hasConnectedWhatsAppAccount()` and skip in that case.
   */
  async seedConnectedWhatsAppAccount(): Promise<boolean> {
    const { accessToken, phoneNumberId, wabaId, phoneNumber, displayName } =
      TEST_DATA.whatsapp;
    if (!accessToken || !phoneNumberId || !wabaId || !phoneNumber) {
      console.warn(
        '[SeedHelper] Skipping WhatsApp seed — TEST_WHATSAPP_ACCESS_TOKEN / ' +
          '_PHONE_NUMBER_ID / _WABA_ID / _PHONE_NUMBER not all set.'
      );
      return false;
    }

    const { orgId, userId } = await this.getSessionInfo();
    if (!orgId || !userId) {
      throw new Error(
        '[SeedHelper] Cannot seed WhatsApp — no active org/user in session.'
      );
    }

    const response = await this.request.post(
      `${API_URL}/testing/seed-whatsapp`,
      {
        headers: this.authHeaders,
        data: {
          organizationId: orgId,
          connectedById: userId,
          accessToken,
          phoneNumberId,
          wabaId,
          phoneNumber,
          displayName: displayName || undefined,
        },
      }
    );
    const result = (await response.json()) as {
      success: boolean;
      message?: string;
    };
    if (!result.success) {
      throw new Error(`Failed to seed WhatsApp account: ${result.message}`);
    }
    console.log(
      `[SeedHelper] Seeded WhatsApp account for org ${orgId} (phone ${phoneNumberId})`
    );
    return true;
  }

  /**
   * Re-seed the connected org's Meta Ads (Facebook) integration from a
   * system-user token via POST /testing/seed-meta-ads.
   *
   * The connected org's original Facebook connection came from a real user
   * OAuth, so its token dies whenever the account password changes. Seeding
   * from a never-expiring FLFB system-user token on every connected setup
   * makes the connection self-healing. Idempotent upsert; no Meta API calls.
   *
   * No-op (returns false) when TEST_META_ACCESS_TOKEN / TEST_META_PAGE_ID /
   * TEST_META_AD_ACCOUNT_ID are not all set — the ad account id is required
   * because the upsert would otherwise null the integration's adAccountId.
   */
  async seedConnectedMetaAdsIntegration(): Promise<boolean> {
    const { accessToken, adAccountId, adAccountName, pageName } =
      TEST_DATA.metaAds;
    const pageId = TEST_DATA.metaPageId;
    if (!accessToken || !pageId || !adAccountId) {
      console.warn(
        '[SeedHelper] Skipping Meta Ads seed — TEST_META_ACCESS_TOKEN / ' +
          'TEST_META_PAGE_ID / TEST_META_AD_ACCOUNT_ID not all set.'
      );
      return false;
    }

    const { orgId, userId } = await this.getSessionInfo();
    if (!orgId || !userId) {
      throw new Error(
        '[SeedHelper] Cannot seed Meta Ads — no active org/user in session.'
      );
    }

    const response = await this.request.post(
      `${API_URL}/testing/seed-meta-ads`,
      {
        headers: this.authHeaders,
        data: {
          organizationId: orgId,
          connectedById: userId,
          accessToken,
          pageId,
          pageName: pageName || undefined,
          adAccountId,
          adAccountName: adAccountName || undefined,
        },
      }
    );
    const result = (await response.json()) as {
      success: boolean;
      message?: string;
    };
    if (!result.success) {
      throw new Error(`Failed to seed Meta Ads integration: ${result.message}`);
    }
    console.log(
      `[SeedHelper] Seeded Meta Ads integration for org ${orgId} (page ${pageId})`
    );
    return true;
  }

  /**
   * Whether the current session's org has at least one WhatsApp account.
   * Used by connected WhatsApp specs to skip gracefully when seeding was a
   * no-op (no TEST_WHATSAPP_* creds configured).
   */
  async hasConnectedWhatsAppAccount(): Promise<boolean> {
    const result = (await this.authenticatedApiCall(
      'GET',
      '/integrations/whatsapp/accounts'
    )) as { accounts?: Array<{ phoneNumberId: string }> };
    return (result.accounts?.length ?? 0) > 0;
  }

  /**
   * Dynamically fetch the connected org's WhatsApp phone number ID.
   * Avoids hard-coded env vars — survives re-provisioning of the WhatsApp integration.
   */
  async getConnectedWhatsAppPhoneNumberId(): Promise<string> {
    const result = await this.authenticatedApiCall(
      'GET',
      '/integrations/whatsapp/accounts'
    );
    const accounts = (result as { accounts: Array<{ phoneNumberId: string }> })
      .accounts;
    if (!accounts?.[0]?.phoneNumberId) {
      throw new Error('Connected user has no WhatsApp account');
    }
    return accounts[0].phoneNumberId;
  }

  /**
   * Wait until the bot has STOPPED sending — i.e. the bot-message count for a
   * conversation holds steady for `stableForMs`.
   *
   * Replaces the blind `await sleep(15_000)` that used to sit between turns.
   * A fixed sleep is a coin flip in both directions: too short and a trailing
   * multi-part delivery lands in the *next* turn's assertions; too long and
   * every run pays for the worst case. Quiescence is the condition those sleeps
   * were actually reaching for, so wait on it directly.
   *
   * Also the honest way to assert a NEGATIVE ("no second reply arrived"): you
   * cannot poll for the absence of a thing, but you can wait for the stream to
   * settle and then assert the count.
   *
   * @returns the bot messages once the count has settled.
   */
  async waitForBotQuiescence(
    conversationId: string,
    { stableForMs = 5_000, timeoutMs = 60_000 } = {}
  ): Promise<Array<{ id: string; role: string; content: string | null }>> {
    const pollMs = 1_000;
    const deadline = Date.now() + timeoutMs;

    const botMessages = async () =>
      (await this.getConversationMessages(conversationId, 50)).filter(
        (m) => m.role === 'bot' && m.content
      );

    let last = await botMessages();
    let stableSince = Date.now();

    while (Date.now() < deadline) {
      await backOff(pollMs);
      const current = await botMessages();

      if (current.length !== last.length) {
        last = current;
        stableSince = Date.now(); // still delivering — restart the settle window
        continue;
      }
      if (Date.now() - stableSince >= stableForMs) return current;
    }

    throw new Error(
      `[waitForBotQuiescence] bot was still delivering after ${timeoutMs}ms ` +
        `(conversation ${conversationId}, ${last.length} bot messages so far)`
    );
  }

  /**
   * Get conversation messages via the testing endpoint.
   */
  async getConversationMessages(
    conversationId: string,
    limit = 20
  ): Promise<
    Array<{
      id: string;
      role: string;
      content: string | null;
      metadata: unknown;
      createdAt: string;
    }>
  > {
    const response = await this.request.get(
      `${API_URL}/testing/conversation-messages?conversationId=${encodeURIComponent(conversationId)}&limit=${limit}`,
      { headers: this.authHeaders }
    );
    const result = await response.json();
    if (!result.success) {
      throw new Error(`Failed to get conversation messages: ${result.message}`);
    }
    return result.messages;
  }

  /**
   * Inspect a conversation's CTWA attribution + high-intent classification
   * (PRD-1). Look up by `conversationId`, or by
   * `organizationId` + `platform` + `externalUserId` (handy after a live
   * click-to-WhatsApp message, when you only have the WhatsApp number).
   */
  async getConversationIntent(params: {
    conversationId?: string;
    organizationId?: string;
    platform?: 'facebook_messenger' | 'instagram_dm' | 'whatsapp';
    externalUserId?: string;
  }): Promise<{
    conversationId: string;
    organizationId: string;
    platform: string;
    externalUserId: string;
    externalUserName: string | null;
    attribution: {
      adMetaId: string | null;
      adInternalId: string | null;
      adTitle: string | null;
      attributed: boolean;
    };
    stage: string | null;
    bookingInterest: boolean;
    userMessageCount: number;
    isHighIntent: boolean;
    reasons: string[];
  }> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) qs.set(key, value);
    }
    const response = await this.request.get(
      `${API_URL}/testing/conversation-intent?${qs.toString()}`,
      { headers: this.authHeaders }
    );
    if (!response.ok()) {
      throw new Error(
        `Failed to get conversation intent: ${response.status()} ${await response.text()}`
      );
    }
    return response.json();
  }

  /**
   * Poll for a bot response in a conversation.
   * Waits until a message with role 'bot' appears after the most recent user message.
   */
  async waitForBotResponse(
    conversationId: string,
    timeoutMs = 60_000
  ): Promise<{ content: string; metadata: unknown }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const messages = await this.getConversationMessages(conversationId);
      const botMessage = messages.find((m) => m.role === 'bot');
      if (botMessage?.content) {
        return { content: botMessage.content, metadata: botMessage.metadata };
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(
      `No bot response in conversation ${conversationId} within ${timeoutMs}ms`
    );
  }

  /**
   * Update organization settings via the testing API.
   * Uses PATCH /testing/update-org-settings (SEED_TOKEN auth, no session needed).
   */
  async updateOrganizationSettings(
    organizationId: string,
    updates: {
      /**
       * Field of record for where customers book (ENG-500). `bookingDestination`
       * is what the wire accepts — `primaryCalendarType` is derived server-side
       * and is silently stripped if sent, so setting it configures nothing.
       */
      bookingDestination?: 'borradh' | 'external_link';
      defaultBookingLink?: string | null;
    }
  ): Promise<void> {
    const response = await this.request.patch(
      `${API_URL}/testing/update-org-settings`,
      {
        headers: this.authHeaders,
        data: { organizationId, ...updates },
      }
    );
    const result = await response.json();
    if (!result.success) {
      throw new Error(`Failed to update org settings: ${result.message}`);
    }
  }

  /**
   * Mint a patient manage-booking link for an appointment.
   *
   * The raw token is NOT recoverable from the DB (only its SHA-256 is stored),
   * so this asks the API to issue a fresh one — exactly what the confirmation
   * email does. Returns the token and the full URL.
   *
   * Uses POST /testing/manage-booking-link (SEED_TOKEN auth).
   */
  async issueManageBookingLink(
    appointmentId: string
  ): Promise<{ token: string; url: string }> {
    const response = await this.request.post(
      `${API_URL}/testing/manage-booking-link`,
      {
        headers: this.authHeaders,
        data: { appointmentId },
      }
    );
    const result = (await response.json()) as {
      success: boolean;
      token?: string;
      url?: string;
      message?: string;
    };
    if (!result.success || !result.token || !result.url) {
      throw new Error(
        `Failed to issue manage-booking link: ${result.message ?? 'unknown error'}`
      );
    }
    return { token: result.token, url: result.url };
  }

  /**
   * Update chatbot settings via the testing API.
   * Uses PUT /testing/update-chatbot-settings (SEED_TOKEN auth, no session needed).
   */
  async updateChatbotSettings(
    organizationId: string,
    updates: {
      chatbotSystemPrompt?: string | null;
      chatbotSettings?: Record<string, unknown>;
    }
  ): Promise<void> {
    const response = await this.request.put(
      `${API_URL}/testing/update-chatbot-settings`,
      {
        headers: this.authHeaders,
        data: { organizationId, ...updates },
      }
    );
    const result = await response.json();
    if (!result.success) {
      throw new Error(`Failed to update chatbot settings: ${result.message}`);
    }
  }

  /**
   * Get the conversation status (bot_handling, agent_handling, etc.).
   */
  async getConversationStatus(conversationId: string): Promise<string | null> {
    // Use the testing endpoint to get the status directly
    const response = await this.request.get(
      `${API_URL}/testing/conversation-status?conversationId=${encodeURIComponent(conversationId)}`,
      { headers: this.authHeaders }
    );
    const result = await response.json();
    return result.status ?? null;
  }

  /**
   * Upload files to a react-dropzone input.
   *
   * React-dropzone uses the File System Access API (showOpenFilePicker) in
   * modern browsers, bypassing the hidden <input> entirely. This means both
   * Playwright's setInputFiles and CDP's DOM.setFileInputFiles fail silently.
   *
   * Fix: delete window.showOpenFilePicker to force react-dropzone to use the
   * <input> fallback, reload the page, then use the filechooser event.
   *
   * @param filePaths - Array of absolute file paths to upload
   * @param dropzoneSelector - CSS selector for the dropzone click target
   */
  async uploadFilesViaDropzone(
    filePaths: string[],
    _dropzoneSelector = 'text=Drop your files here'
  ): Promise<void> {
    // Wait for the UploadProvider to mount so its dropzone is wired up.
    await this.page.waitForFunction(
      () =>
        typeof (window as unknown as Record<string, unknown>).__e2eAddFiles ===
        'function',
      { timeout: 10_000 }
    );

    // setInputFiles triggers react-dropzone's onChange → onDrop → addFiles.
    // Don't also call __e2eAddFiles afterwards — that double-fires addFiles
    // with the same File objects, which creates duplicate upload rows and
    // makes both uploads fail.
    const fileInput = this.page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePaths);
  }

  /**
   * Get a single video's full details via the real API.
   * Used to verify rendering output (status, thumbnail, duration, config).
   */
  async getVideo(videoId: string): Promise<{
    id: string;
    status: string;
    thumbnailUrl: string | null;
    blobUrl: string | null;
    durationMs: number | null;
    draftConfig: Record<string, unknown>;
  }> {
    const result = (await this.authenticatedApiCall(
      'GET',
      `/videos/${videoId}`
    )) as {
      id: string;
      status: string;
      thumbnailUrl?: string | null;
      blobUrl?: string | null;
      durationMs?: number | null;
      draftConfig?: Record<string, unknown>;
    };
    return {
      id: result.id,
      status: result.status,
      thumbnailUrl: result.thumbnailUrl ?? null,
      blobUrl: result.blobUrl ?? null,
      durationMs: result.durationMs ?? null,
      draftConfig: result.draftConfig ?? {},
    };
  }

  /**
   * Delete a social post via the real API.
   */
  async deleteSocialPost(postId: string): Promise<void> {
    // 409 = post is mid-publish and can't be deleted yet; expected during
    // cleanup, not worth logging.
    await this.authenticatedApiCall(
      'DELETE',
      `/social-posts/${postId}`,
      undefined,
      [409]
    );
  }

  /**
   * Navigate to a protected dashboard page with auth-redirect resilience.
   *
   * On staging CI, rate limiting or cold-start can cause /auth/session to
   * return 429, which makes the SSR layout redirect to sign-in even though
   * storageState has valid cookies. This helper retries up to 3 times with
   * increasing back-off to ride out transient 429s.
   */
  async gotoDashboardPage(
    path: string,
    options?: { timeout?: number }
  ): Promise<void> {
    const timeout = options?.timeout ?? 30_000;
    const maxRetries = 3;
    // Branch-scoped paths resolve to `/dashboard/l/<branch>/…` so the suite
    // navigates to the URL the app actually produces, rather than leaning on
    // the compatibility splat's redirect. Org-level paths pass through.
    const target = await branchUrl(this.page, path);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await this.page.goto(target, { waitUntil: 'domcontentloaded' });

      if (!this.page.url().includes('/sign-in')) break;

      if (attempt < maxRetries) {
        const backoff = 2000 * (attempt + 1);
        console.log(
          `[SeedHelper] Redirected to sign-in (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoff}ms...`
        );
        await backOff(backoff);
      }
    }

    // Wait for sidebar to confirm auth state loaded
    await this.page
      .locator('[data-sidebar="menu-button"]')
      .last()
      .waitFor({ timeout });
  }

  /**
   * Navigate to a protected non-dashboard page (e.g. /upload-assets, /create-video/*).
   *
   * These pages don't have a sidebar, so we can't wait for it. Instead we
   * retry if redirected to sign-in and wait for the page content.
   */
  async gotoProtectedPage(
    path: string,
    _options?: { timeout?: number }
  ): Promise<void> {
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await this.page.goto(path, { waitUntil: 'domcontentloaded' });

      if (!this.page.url().includes('/sign-in')) return;

      if (attempt < maxRetries) {
        const backoff = 2000 * (attempt + 1);
        console.log(
          `[SeedHelper] Redirected to sign-in (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoff}ms...`
        );
        await backOff(backoff);
      }
    }
  }

  // ─── Verification Helpers ──────────────────────────────────

  /**
   * Assert no error toast or Meta error dialog appears on the page.
   *
   * This is the primary failure detector for the ads suite, so it must actually
   * WAIT: an error dialog/toast lands a beat after the mutation's response, and
   * the old `isVisible({ timeout })` returned instantly (its timeout is ignored),
   * so it sailed past nearly every real failure and the test then died on a
   * confusing downstream assertion — or, worse, passed.
   *
   * Now it races both error surfaces against `timeoutMs` of real waiting: it
   * resolves the moment either appears (throwing with its text), and otherwise
   * returns clean once the window has elapsed with neither present.
   */
  async assertNoError(context: string, timeoutMs = 5000): Promise<void> {
    const page = this.page;

    const metaErrorDialog = page
      .locator('[role="dialog"]')
      .filter({ hasText: /error|failed/i })
      .first();
    const errorToast = page
      .locator('[data-sonner-toast][data-type="error"]')
      .first();

    const appeared = await Promise.race([
      metaErrorDialog
        .waitFor({ state: 'visible', timeout: timeoutMs })
        .then(() => 'dialog' as const)
        .catch(() => null),
      errorToast
        .waitFor({ state: 'visible', timeout: timeoutMs })
        .then(() => 'toast' as const)
        .catch(() => null),
    ]);

    if (appeared === 'dialog') {
      const text = await metaErrorDialog.textContent().catch(() => null);
      throw new Error(
        `[${context}] Meta error dialog: ${text?.substring(0, 300) ?? '(no text)'}`
      );
    }

    if (appeared === 'toast') {
      const text = await errorToast.textContent().catch(() => null);
      throw new Error(`[${context}] Error toast: ${text ?? '(no text)'}`);
    }
  }

  /**
   * Poll until an ad reaches Active status on Meta.
   * Replaces blind waitForTimeout calls with status-aware polling.
   *
   * Tuned to minimise Meta Marketing API calls: 30s interval (was 15s) and
   * only the ad-status call per poll — the campaign-status check was dropped
   * since the publish flow already activates the campaign. Together that cuts
   * a worst-case run from ~40 to ~10 Meta calls.
   *
   * @returns The final ad status
   * @throws If timeout is reached — includes the last-seen status in the error
   */
  async waitForAdActive(
    metaCampaignId: string,
    adName: string,
    timeoutMs = 300_000
  ): Promise<{ adStatus: string }> {
    const pollInterval = 30_000;
    const start = Date.now();
    let lastAdStatus = 'unknown';
    // The ad row carries WHY it failed. Without it, "the launch errored
    // immediately" and "verification never completed" are the same 300 seconds
    // of `ad=launching` followed by an error naming only the status — which is
    // what made every launch failure a code-reading exercise.
    let lastSyncError: string | null = null;

    while (Date.now() - start < timeoutMs) {
      const ads = await this.listAds(metaCampaignId);
      const ad = ads.find((a) =>
        a.name.toLowerCase().includes(adName.toLowerCase())
      );
      lastAdStatus = ad?.status ?? 'not_found';
      lastSyncError = ad?.syncError ?? null;

      console.log(
        `[waitForAdActive] ad=${lastAdStatus} (${Math.round((Date.now() - start) / 1000)}s)${
          lastSyncError ? ` syncError=${lastSyncError}` : ''
        }`
      );

      if (lastAdStatus.toLowerCase() === 'active') {
        return { adStatus: lastAdStatus };
      }

      // Fail fast on terminal error states
      const terminalStatuses = ['error', 'disapproved', 'deleted'];
      if (terminalStatuses.includes(lastAdStatus.toLowerCase())) {
        throw new Error(
          `[waitForAdActive] Ad reached terminal status: ad=${lastAdStatus}.${
            lastSyncError
              ? ` The API recorded: ${lastSyncError}`
              : ' No syncError was recorded on the ad row.'
          }`
        );
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    throw new Error(
      `[waitForAdActive] Timed out after ${timeoutMs / 1000}s. Last ad status: ${lastAdStatus}.${
        lastSyncError
          ? ` The API recorded: ${lastSyncError}`
          : lastAdStatus === 'not_found'
            ? ' The ad never appeared under this campaign — the publish did not create one, or the list read it from a different source than the create wrote to.'
            : ' No syncError was recorded, so the launch did not fail — it never finished verifying (see verify-ad-launch-state / ADR-005).'
      }`
    );
  }

  /**
   * Get a single ad by ID via the real API.
   */
  async getAd(
    adId: string
  ): Promise<{ id: string; name: string; status: string; headline?: string }> {
    const result = (await this.authenticatedApiCall(
      'GET',
      `/meta-ads/${adId}`
    )) as { id: string; name: string; status: string; headline?: string };
    return result;
  }

  /**
   * Get a single social post by ID via the real API.
   */
  async getSocialPost(
    postId: string
  ): Promise<{ id: string; title: string; status: string }> {
    const result = (await this.authenticatedApiCall(
      'GET',
      `/social-posts/${postId}`
    )) as { id: string; title: string; status: string };
    return result;
  }

  /**
   * List social posts via the real API.
   */
  async listSocialPosts(): Promise<
    Array<{ id: string; title: string; status: string }>
  > {
    const result = (await this.authenticatedApiCall(
      'GET',
      '/social-posts'
    )) as {
      posts?: Array<{ id: string; title: string; status: string }>;
      items?: Array<{ id: string; title: string; status: string }>;
    };
    return result.posts ?? result.items ?? [];
  }

  // ─── Content batches / image generation (testing endpoints) ──────

  /**
   * Trigger the monthly content batch for an org via the testing endpoint
   * (skips the 1st-of-month cron wait). Returns the seeded batch metadata.
   */
  async triggerMonthlyContentBatch(input: {
    organizationId: string;
    periodMonth?: string;
    graphicCount?: number;
    videoCount?: number;
  }): Promise<{
    batchId: string;
    graphicsSeeded: number;
    videosSeeded: number;
    jobsEnqueued: number;
    failures: string[];
    alreadyExisted: boolean;
  }> {
    const response = await this.request.post(
      `${API_URL}/testing/trigger-monthly-content-batch`,
      { headers: this.authHeaders, data: input }
    );
    const data = await response.json();
    if (!data.success) {
      throw new Error(
        `Failed to trigger monthly content batch: ${data.message ?? response.status()}`
      );
    }
    return {
      batchId: data.batchId,
      graphicsSeeded: data.graphicsSeeded ?? 0,
      videosSeeded: data.videosSeeded ?? 0,
      jobsEnqueued: data.jobsEnqueued ?? 0,
      failures: data.failures ?? [],
      alreadyExisted: data.alreadyExisted ?? false,
    };
  }

  /**
   * Poll `GET /content-batches/:id` until every graphic item reaches a
   * terminal state (`ready` or `failed`), then return the final batch detail.
   * Graphics render synchronously in the worker (Fabric), so this resolves in
   * seconds-to-minutes rather than the Gemini-batch turnaround the old
   * nano-banana path needed.
   */
  async waitForContentBatchGraphics(
    contentBatchId: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number }
  ): Promise<ContentBatchDetail> {
    const timeoutMs = options?.timeoutMs ?? 5 * 60 * 1000;
    const pollIntervalMs = options?.pollIntervalMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;
    let last: ContentBatchDetail | null = null;

    while (Date.now() < deadline) {
      const detail = (await this.authenticatedApiCall(
        'GET',
        `/content-batches/${contentBatchId}`
      )) as ContentBatchDetail;
      last = detail;

      const graphicItems = detail.items.filter((i) => i.kind === 'graphic');
      const allTerminal =
        graphicItems.length > 0 &&
        graphicItems.every(
          (i) => i.graphic?.status === 'ready' || i.graphic?.status === 'failed'
        );
      if (allTerminal) return detail;

      await backOff(pollIntervalMs);
    }

    const statuses = (last?.items ?? [])
      .filter((i) => i.kind === 'graphic')
      .map((i) => i.graphic?.status ?? 'null');
    throw new Error(
      `content batch ${contentBatchId} graphics did not finish within ${timeoutMs}ms (statuses: ${statuses.join(', ')})`
    );
  }

  /**
   * Delete a content batch and everything it spawned via the testing
   * endpoint. Best-effort — logs rather than throws so test teardown never
   * masks the real assertion failure.
   */
  async cleanupContentBatch(contentBatchId: string): Promise<void> {
    const response = await this.request.post(
      `${API_URL}/testing/cleanup-content-batch`,
      { headers: this.authHeaders, data: { contentBatchId } }
    );
    const data = await response.json().catch(() => ({ success: false }));
    if (!data.success) {
      console.warn(
        `[SeedHelper] cleanupContentBatch(${contentBatchId}) failed: ${data.message ?? response.status()}`
      );
    }
  }
}

/**
 * Shape of `GET /content-batches/:id` used by the image-generation spec.
 * The endpoint returns `{ batch, items }`: the batch row (id/status/…) is
 * nested under `batch`, while the hydrated `items` are top-level.
 */
export interface ContentBatchDetail {
  batch: {
    id: string;
    status: string;
  };
  items: Array<{
    id: string;
    kind: 'video' | 'graphic';
    reviewStatus: string;
    graphicId: string | null;
    graphic: {
      id: string;
      status: string;
      outputs: unknown;
    } | null;
  }>;
}
