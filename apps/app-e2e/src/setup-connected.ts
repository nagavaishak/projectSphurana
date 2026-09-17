import { test as setup } from '@playwright/test';
import { SeedHelper, TEST_DATA, branchUrl } from './fixtures/index.js';
import { stampAuthFile } from './fixtures/stack-identity.fixture.js';

const AUTH_FILE = '.auth/connected-user.json';

/**
 * Auth setup for the connected org (Meta + Instagram integration).
 * Used by the `connected` project (and its sub-projects).
 *
 * Signs in through the real UI — no testing endpoints needed.
 * The connected user must already exist with Meta and Instagram connected.
 *
 * Cookie-session auth on the web (see api-client.ts). Playwright's
 * `storageState` captures session cookies by domain.
 */
setup('authenticate connected user', async ({ page, request }) => {
  setup.setTimeout(120_000);

  const seed = new SeedHelper(page, request);
  const email = TEST_DATA.connectedUser.email;
  const password = TEST_DATA.connectedUser.password;

  if (!email || !password) {
    throw new Error(
      'TEST_CONNECTED_USER_EMAIL and TEST_CONNECTED_USER_PASSWORD must be set'
    );
  }

  // Ensure the shared connected fixture EXISTS before signing in — same
  // reproducible-from-code guarantee as the bare org. The Facebook + WhatsApp
  // integrations are attached idempotently below (seedConnected*), so the org is
  // rebuildable after a preview-DB reset.
  //
  // NOTE: Instagram is NOT yet reproducible — there is no `seed-instagram`
  // testing endpoint, so a from-scratch connected org has Facebook + WhatsApp but
  // not Instagram. Instagram-specific specs still need that endpoint (a DB upsert
  // from the same system-user token, mirroring seed-meta-ads). Remaining gap.
  const orgId = await seed.ensureProvisionedOrg({
    email,
    password,
    name: 'E2E Connected Owner',
    orgName: 'E2E Connected Salon',
    businessType: 'salon',
  });
  console.log(`[Setup Connected] Ensured connected org ${orgId} exists`);

  await seed.signInUser(email, password);

  // Navigate to home and wait for the sidebar so we know auth is fully loaded.
  await page.goto(await branchUrl(page, '/dashboard/home'));
  await page
    .locator('[data-sidebar="menu-button"]')
    .last()
    .waitFor({ timeout: 30_000 });

  const state = await page.context().storageState({ path: AUTH_FILE });
  const sessionCookies = state.cookies.filter(
    (c) => c.name.includes('session') || c.name.includes('better-auth')
  );
  if (sessionCookies.length === 0) {
    throw new Error(
      '[Setup Connected] No session cookies found after sign-in — connected auth setup failed.'
    );
  }

  // Record WHICH stack minted this session — see setup-bare.ts and
  // fixtures/stack-identity.fixture.ts.
  await stampAuthFile(AUTH_FILE);

  // Media seeding uses testing endpoints (no Meta calls) — always needed.
  // The connected org needs SERVICES, same as the bare org.
  //
  // setup-bare has always called this; setup-connected never did, so the
  // connected org only had services where they had accumulated on a long-lived
  // database. Provisioned into a fresh one it has none — and two chatbot specs
  // ask the bot about services:
  //   - conversation-continuity: turn 2 is "What services do you have?"
  //   - service-inquiry: "bot mentions real services when asked"
  // With nothing to answer from, the bot produces no usable second reply and
  // both fail deterministically (3/3 attempts), while passing on preview purely
  // because that org had services from earlier runs.
  //
  // Idempotent: prices any unpriced service and creates one when there are none.
  await seed.ensureServicesPriced();
  console.log(
    '[Setup Connected] Ensured the connected org has priced services'
  );

  await seed.ensureCreatedVideo();
  await seed.ensureUploadedVideo();

  // Seed a valid WhatsApp connection (whatsapp_account row) from a system-user
  // token. The connected org can no longer complete WhatsApp Embedded Signup,
  // so the integration is injected directly. This is a cheap idempotent DB
  // upsert (no rate-limited Meta calls), so it runs on every connected setup —
  // unlike the gated Meta campaign seed below. No-op when TEST_WHATSAPP_* env
  // vars are unset; the connected WhatsApp specs guard on the account existing.
  await seed.seedConnectedWhatsAppAccount();

  // Re-seed the Meta Ads (Facebook) connection from the never-expiring
  // system-user token. The original user-OAuth token dies whenever the
  // Facebook account password changes; this idempotent DB upsert (no Meta
  // calls) restores tokenStatus to 'valid' on every connected setup. No-op
  // when TEST_META_ACCESS_TOKEN / TEST_META_AD_ACCOUNT_ID are unset.
  await seed.seedConnectedMetaAdsIntegration();

  // Seed the Stripe Connect integration from a REAL connected account id so the
  // connected org shows as genuinely connected (Active) — otherwise a human in
  // preview lands on "Set up payments" and POST /integrations/stripe/account-link
  // 500s (the onboarding calls aren't covered by STRIPE_E2E_STUB). Idempotent DB
  // upsert, no Stripe calls. No-op when TEST_STRIPE_CONNECT_ACCOUNT_ID is unset.
  await seed.seedConnectedStripeConnect();

  // The Meta campaign cleanup + seed only matter for the connected-ads
  // project. setup-connected runs once per playwright invocation, so the
  // `connected` and `connected-chatbot` runs would otherwise repeat this
  // Meta Marketing API work for nothing. Gate it to the connected-ads run
  // (E2E_SEED_META_ADS, set by that workflow step) and to any local run,
  // where the rate limit is not a concern.
  const seedMetaAds =
    process.env.E2E_SEED_META_ADS === 'true' || !process.env.CI;
  if (seedMetaAds) {
    // Clean up orphaned E2E campaigns/ads from previous failed runs.
    await seed.cleanupE2ECampaignsAndAds();
    await seed.ensureCampaign();
  }
});
