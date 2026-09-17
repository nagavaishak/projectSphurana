import { expect, test } from '@playwright/test';
import { SeedHelper, TEST_DATA } from '../fixtures/index.js';

test.describe('Chatbot — Message Interruption', () => {
  test.setTimeout(120_000);

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({
      storageState: '.auth/connected-user.json',
    });
    const page = await context.newPage();
    const seed = new SeedHelper(page, request);
    // Ensure the chatbot is enabled
    await seed.ensureChatbotEnabled(TEST_DATA.metaPageId);
    await context.close();
  });

  test('second message during delay window cancels pending job', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    const senderId = `e2e-sender-${Date.now()}-interruption`;

    let conversationId: string;

    await test.step('send first message with 15s delay', async () => {
      const result = await seed.simulateWebhook({
        platform: 'facebook_messenger',
        pageId: TEST_DATA.metaPageId,
        senderId,
        messageText: 'Hello',
        queueDelayMs: 15_000,
      });
      conversationId = result.conversationId;
      expect(conversationId).toBeTruthy();
    });

    await test.step('immediately send second message (cancels pending)', async () => {
      const result = await seed.simulateWebhook({
        platform: 'facebook_messenger',
        pageId: TEST_DATA.metaPageId,
        senderId,
        messageText: 'Actually I want to book an appointment',
        queueDelayMs: 0,
      });
      // Same conversation reused
      expect(result.conversationId).toBe(conversationId);
    });

    await test.step('verify only one bot response', async () => {
      // Wait for the bot to respond
      const response = await seed.waitForBotResponse(conversationId, 60_000);
      expect(response.content).toBeTruthy();

      // Assert a NEGATIVE ("no second reply arrived"), so we must let the
      // stream actually settle first — otherwise a blind sleep that's a beat
      // too short passes for the wrong reason, and a slow worker turns the
      // real behaviour into a false green.
      const botMessages = await seed.waitForBotQuiescence(conversationId);
      // Exactly 1 bot response: the second message cancelled the first.
      expect(
        botMessages.length,
        `expected the interrupting message to cancel the first reply, but the bot sent ${botMessages.length} messages`
      ).toBe(1);
    });
  });
});
