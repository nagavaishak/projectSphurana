import { expect, test } from '@playwright/test';
import { SeedHelper } from '../fixtures/index.js';

/**
 * The connected org's WhatsApp account is seeded by `setup-connected` from the
 * TEST_WHATSAPP_* env vars (see SeedHelper.seedConnectedWhatsAppAccount). Those
 * vars are the ENVIRONMENT precondition — knowable before the browser opens —
 * so they gate the suite at describe level. Once they ARE set, the seeded
 * account MUST exist: a missing account is a seeding regression and is asserted,
 * not skipped.
 */
const HAS_WHATSAPP_CREDS = Boolean(
  process.env.TEST_WHATSAPP_ACCESS_TOKEN &&
    process.env.TEST_WHATSAPP_PHONE_NUMBER_ID &&
    process.env.TEST_WHATSAPP_WABA_ID &&
    process.env.TEST_WHATSAPP_PHONE_NUMBER
);

test.describe('Chatbot — WhatsApp Smoke', () => {
  test.setTimeout(120_000);

  test.skip(
    !HAS_WHATSAPP_CREDS,
    'WhatsApp creds not configured (set TEST_WHATSAPP_ACCESS_TOKEN / _PHONE_NUMBER_ID / _WABA_ID / _PHONE_NUMBER)'
  );

  let seed: SeedHelper;
  let orgId: string;
  let orgSlug: string;
  let whatsappPhoneNumberId: string;
  let originalSettings: unknown;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({
      storageState: '.auth/connected-user.json',
    });
    const page = await context.newPage();
    seed = new SeedHelper(page, request);

    // Creds are set, so setup-connected must have seeded the account.
    const hasAccount = await seed.hasConnectedWhatsAppAccount();
    expect(
      hasAccount,
      'connected org should have a seeded WhatsApp account'
    ).toBe(true);

    orgId = (await seed.getActiveOrganizationId()) ?? '';
    expect(orgId).toBeTruthy();

    whatsappPhoneNumberId = await seed.getConnectedWhatsAppPhoneNumberId();

    // Save original settings for cleanup
    originalSettings = await seed.authenticatedApiCall(
      'GET',
      '/organization/active'
    );
    orgSlug = (originalSettings as { slug?: string })?.slug ?? '';
    expect(orgSlug).toBeTruthy();
    await context.close();
  });

  test('bot responds via WhatsApp with borradh booking link', async ({
    page,
    request,
  }) => {
    seed = new SeedHelper(page, request);
    const senderId = `+1555${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 100)}`;

    await test.step('set calendar type to borradh', async () => {
      await seed.updateOrganizationSettings(orgId, {
        bookingDestination: 'borradh',
        defaultBookingLink: null,
      });
    });

    let conversationId: string;

    await test.step('simulate WhatsApp webhook message', async () => {
      const result = await seed.simulateWebhook({
        platform: 'whatsapp',
        pageId: whatsappPhoneNumberId,
        senderId,
        messageText: 'I want to book an appointment',
        queueDelayMs: 0,
      });
      conversationId = result.conversationId;
      expect(conversationId).toBeTruthy();
    });

    await test.step('wait for bot response with booking link', async () => {
      const response = await seed.waitForBotResponse(conversationId, 60_000);
      expect(response.content).toBeTruthy();
      // The microsite base, not the retired top-level `/book/{slug}` — see the
      // same assertion in booking-link-borradh.connected.spec.ts.
      const content = response.content.toLowerCase();
      expect(content).toContain(`/sites/${orgSlug.toLowerCase()}/book`);
      expect(content).not.toContain(`/book/${orgSlug.toLowerCase()}`);
    });
  });

  // PRD-1 — Click-to-WhatsApp attribution + high-intent classification.
  // Drives the same simulate-webhook path as the smoke test above, but with an
  // `adReferral` so the conversation is attributed to a campaign, then reads
  // the diagnostic inspection endpoint. Intent assertions use the deterministic
  // engagement arm (≥3 user messages) and a queued (unprocessed) single message
  // so they don't depend on the LLM's stage tagging.
  test('attributes a click-to-WhatsApp conversation and classifies intent', async ({
    page,
    request,
  }) => {
    seed = new SeedHelper(page, request);
    const adMetaId = `e2e-ctwa-ad-${Date.now()}`;

    // --- High intent: 3 user messages → engagement arm fires ---
    const highSender = `+1555${String(Date.now()).slice(-7)}01`;
    let highConversationId = '';

    await test.step('simulate a CTWA WhatsApp message (with ad referral)', async () => {
      const result = await seed.simulateWebhook({
        platform: 'whatsapp',
        pageId: whatsappPhoneNumberId,
        senderId: highSender,
        messageText: 'Hi, I came from your Facebook ad',
        adReferral: { metaAdId: adMetaId, adTitle: 'E2E CTWA offer' },
        queueDelayMs: 0,
      });
      highConversationId = result.conversationId;
      expect(highConversationId).toBeTruthy();
    });

    await test.step('attribution lands on the conversation', async () => {
      const intent = await seed.getConversationIntent({
        conversationId: highConversationId,
      });
      // The linchpin: adMetaId is populated and joinable to a campaign.
      expect(intent.attribution.adMetaId).toBe(adMetaId);
      expect(intent.attribution.attributed).toBe(true);
    });

    await test.step('reaches high intent after multi-message engagement', async () => {
      // Two more user messages → 3 total → engagement arm (≥3) fires
      // regardless of how the bot tags the stage.
      for (const text of ['What do you offer?', 'And how much is it?']) {
        await seed.simulateWebhook({
          platform: 'whatsapp',
          pageId: whatsappPhoneNumberId,
          senderId: highSender,
          messageText: text,
          adReferral: { metaAdId: adMetaId },
          queueDelayMs: 0,
        });
      }
      const intent = await seed.getConversationIntent({
        conversationId: highConversationId,
      });
      expect(intent.userMessageCount).toBeGreaterThanOrEqual(3);
      expect(intent.isHighIntent).toBe(true);
      expect(intent.reasons.length).toBeGreaterThan(0);
    });

    // --- Low intent: a single, unprocessed message (bot job deferred) ---
    await test.step('a single fresh message is classified low intent', async () => {
      const lowSender = `+1555${String(Date.now()).slice(-7)}02`;
      const { conversationId } = await seed.simulateWebhook({
        platform: 'whatsapp',
        pageId: whatsappPhoneNumberId,
        senderId: lowSender,
        messageText: 'What are your opening hours?',
        // Defer the bot so it can't tag a high-intent stage before we read.
        queueDelayMs: 120_000,
      });
      const intent = await seed.getConversationIntent({ conversationId });
      expect(intent.userMessageCount).toBe(1);
      expect(intent.isHighIntent).toBe(false);
      expect(intent.reasons).toEqual([]);
    });
  });

  test.afterAll(async ({ browser, request }) => {
    try {
      const context = await browser.newContext({
        storageState: '.auth/connected-user.json',
      });
      const page = await context.newPage();
      const cleanupSeed = new SeedHelper(page, request);
      const orig = originalSettings as Record<string, unknown>;
      await cleanupSeed.updateOrganizationSettings(orgId, {
        bookingDestination:
          (orig?.bookingDestination as 'borradh' | 'external_link') ||
          'borradh',
        defaultBookingLink: (orig?.defaultBookingLink as string) || '',
      });
      await context.close();
    } catch {
      // Best effort cleanup
    }
  });
});
