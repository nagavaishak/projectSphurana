import { expect, test } from '@playwright/test';
import { SeedHelper, TEST_DATA } from '../fixtures/index.js';

test.describe('Chatbot — External Booking Link', () => {
  test.setTimeout(120_000);

  let seed: SeedHelper;
  let orgId: string;
  let originalSettings: unknown;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({
      storageState: '.auth/connected-user.json',
    });
    const page = await context.newPage();
    seed = new SeedHelper(page, request);
    orgId = (await seed.getActiveOrganizationId()) ?? '';
    expect(orgId).toBeTruthy();

    // Ensure the chatbot is enabled
    await seed.ensureChatbotEnabled(TEST_DATA.metaPageId);

    originalSettings = await seed.authenticatedApiCall(
      'GET',
      '/organization/active'
    );
    await context.close();
  });

  test('bot includes external booking link when configured', async ({
    page,
    request,
  }) => {
    seed = new SeedHelper(page, request);
    const senderId = `e2e-sender-${Date.now()}-external-booking`;
    const externalLink = 'https://calendly.com/test-salon';

    await test.step('set booking destination to external with booking link', async () => {
      await seed.updateOrganizationSettings(orgId, {
        bookingDestination: 'external_link',
        defaultBookingLink: externalLink,
      });
    });

    let conversationId: string;

    await test.step('simulate webhook message', async () => {
      const result = await seed.simulateWebhook({
        platform: 'facebook_messenger',
        pageId: TEST_DATA.metaPageId,
        senderId,
        messageText: 'How do I book?',
        queueDelayMs: 0,
      });
      conversationId = result.conversationId;
      expect(conversationId).toBeTruthy();
    });

    await test.step('wait for bot response with external link', async () => {
      const response = await seed.waitForBotResponse(conversationId, 60_000);
      expect(response.content).toBeTruthy();
      expect(response.content).toContain('calendly.com/test-salon');
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
