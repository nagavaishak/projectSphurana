import { expect, test } from '@playwright/test';
import { SeedHelper, TEST_DATA } from '../fixtures/index.js';

test.describe('Chatbot — Conversation Continuity', () => {
  test.setTimeout(180_000);

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

  test('maintains context across multiple messages in same conversation', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    const senderId = `e2e-sender-${Date.now()}-continuity`;

    let conversationId: string;

    await test.step('send first message', async () => {
      const result = await seed.simulateWebhook({
        platform: 'facebook_messenger',
        pageId: TEST_DATA.metaPageId,
        senderId,
        // First message must carry a clear lead intent (a treatment/service
        // question), not a bare self-introduction. The chatbot prompt's MESSAGE
        // CLASSIFICATION step routes contentless or "personal" openers (e.g. a
        // standalone "my name is X") to silent_handoff — which sends NO message
        // and leaves no row for waitForBotResponse to find, so the conversation
        // never starts. Pairing the name with a real question keeps the
        // continuity context while guaranteeing the bot engages.
        messageText: 'Hi, my name is TestUser. What treatments do you offer?',
        queueDelayMs: 0,
      });
      conversationId = result.conversationId;
      expect(conversationId).toBeTruthy();
    });

    await test.step('wait for first bot response', async () => {
      const response = await seed.waitForBotResponse(conversationId, 60_000);
      expect(response.content).toBeTruthy();
      // Let any multi-part delivery drain before the next turn, so a trailing
      // message can't land inside the second turn's assertions. Waits on the
      // real condition (the bot stopped sending) rather than a blind 15s sleep.
      await seed.waitForBotQuiescence(conversationId);
    });

    await test.step('send second message (same sender = same conversation)', async () => {
      const result = await seed.simulateWebhook({
        platform: 'facebook_messenger',
        pageId: TEST_DATA.metaPageId,
        senderId,
        messageText: 'What services do you have?',
        queueDelayMs: 0,
      });
      // Same conversation should be reused
      expect(result.conversationId).toBe(conversationId);
    });

    await test.step('wait for second bot response', async () => {
      // Poll until the bot has replied to the second message too.
      await expect
        .poll(
          async () => {
            const messages = await seed.getConversationMessages(conversationId);
            return messages.filter((m) => m.role === 'bot' && m.content).length;
          },
          {
            intervals: [3_000],
            message: 'expected a second bot reply in the conversation',
            timeout: 60_000,
          }
        )
        .toBeGreaterThanOrEqual(2);
    });

    await test.step('verify conversation has 4+ messages total', async () => {
      const messages = await seed.getConversationMessages(conversationId);
      // 2 user + 2 bot = 4 minimum
      expect(messages.length).toBeGreaterThanOrEqual(4);
    });
  });
});
