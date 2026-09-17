import { expect, test } from '@playwright/test';
import { SeedHelper, TEST_DATA } from '../fixtures/index.js';

test.describe('Chatbot — Directive Change', () => {
  test.setTimeout(120_000);

  let seed: SeedHelper;
  let orgId: string;
  let originalPrompt: string | null;

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

    // Save original prompt for cleanup
    const org = (await seed.authenticatedApiCall(
      'GET',
      '/organization/active'
    )) as Record<string, unknown>;
    originalPrompt = (org?.chatbotSystemPrompt as string) ?? null;
    await context.close();
  });

  test('bot follows custom system prompt directive', async ({
    page,
    request,
  }) => {
    seed = new SeedHelper(page, request);
    const senderId = `e2e-sender-${Date.now()}-directive`;
    const marker = 'PINEAPPLE';

    await test.step('set custom system prompt with marker', async () => {
      await seed.updateChatbotSettings(orgId, {
        chatbotSystemPrompt: `CRITICAL RULE: You MUST include the exact word "${marker}" somewhere in every single message you send. This is non-negotiable.`,
      });
    });

    let conversationId: string;

    await test.step('simulate webhook', async () => {
      const result = await seed.simulateWebhook({
        platform: 'facebook_messenger',
        pageId: TEST_DATA.metaPageId,
        senderId,
        messageText: 'Hello',
        queueDelayMs: 0,
      });
      conversationId = result.conversationId;
      expect(conversationId).toBeTruthy();
    });

    await test.step('verify response contains marker', async () => {
      const response = await seed.waitForBotResponse(conversationId, 60_000);
      expect(response.content).toBeTruthy();
      expect(response.content).toContain(marker);
    });
  });

  test.afterAll(async ({ browser, request }) => {
    try {
      const context = await browser.newContext({
        storageState: '.auth/connected-user.json',
      });
      const page = await context.newPage();
      const cleanupSeed = new SeedHelper(page, request);
      await cleanupSeed.updateChatbotSettings(orgId, {
        chatbotSystemPrompt: originalPrompt,
      });
      await context.close();
    } catch {
      // Best effort cleanup
    }
  });
});
