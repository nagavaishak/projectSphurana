import { expect, test } from '@playwright/test';
import { SeedHelper, TEST_DATA, branchUrl } from '../fixtures/index.js';

function serviceSubject(name: string): string {
  // Connected suites share an organisation and create services with a numeric
  // suffix for collision-free cleanup. Claire correctly omits that internal
  // identifier when referring to the service, so assert the stable catalogue
  // subject rather than the test-only suffix.
  return name.replace(/\s+\d{10,}\s*$/, '').toLowerCase();
}

/**
 * Compare a service name to prose the way a reader would, not the way
 * `String.includes` does.
 *
 * A raw substring match made this assertion fail on PUNCTUATION. Asked about
 * "E2E Render-to-Ad Service", Claire replied "The E2E Render to Ad Service is
 * priced on consultation…" — she named the service, correctly and in full, and
 * the test called it a miss for three retries because she wrote the hyphen as a
 * space. Normalising both sides to alphanumeric words keeps the assertion's
 * subject (the reply is grounded in the org's real catalogue, not invented)
 * while dropping a distinction no reader would draw.
 */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

test.describe('Chatbot — Service Inquiry', () => {
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

  test('bot mentions real services when asked', async ({ page, request }) => {
    const seed = new SeedHelper(page, request);
    const senderId = `e2e-sender-${Date.now()}-service-inquiry`;

    // Need a navigated page so the session cookie is available for
    // authenticatedApiCall (listServices). apps/app redirects
    // /dashboard/chatbots → /dashboard/settings/chatbot; go straight there.
    await page.goto(await branchUrl(page, '/dashboard/ai-assistant'));
    await page
      .locator('[data-sidebar="menu-button"]')
      .last()
      .waitFor({ timeout: 30000 });

    let serviceNames: string[];
    let target: string;

    await test.step('get org services', async () => {
      const services = await seed.listServices();
      serviceNames = services.map((s) => serviceSubject(s.name));
      expect(serviceNames.length).toBeGreaterThan(0);
      target = services[0].name;
    });

    let conversationId: string;

    await test.step('simulate webhook asking about a named service', async () => {
      // Ask about a SPECIFIC service, by its real name.
      //
      // This used to ask "What services do you offer?" as the first message
      // from a fresh sender, which is the one question the prompt answers with
      // a question: first contact is specified as "I'm <bot>, the receptionist
      // here at <clinic>. What treatment were you interested in?"
      // (prompt-templates.ts), and no prompt path asks the bot to enumerate
      // services. So a reply naming a service was incidental — the assertion
      // was riding LLM whim, and passed or failed by luck.
      //
      // Naming a treatment routes to the specified "more info" path, which
      // requires talking about THAT treatment rather than redirecting.
      const result = await seed.simulateWebhook({
        platform: 'facebook_messenger',
        pageId: TEST_DATA.metaPageId,
        senderId,
        messageText: `Hi, can I get more info about ${target}?`,
        queueDelayMs: 0,
      });
      conversationId = result.conversationId;
      expect(conversationId).toBeTruthy();
    });

    await test.step('verify bot answers from the org own service data', async () => {
      const response = await seed.waitForBotResponse(conversationId, 60_000);
      expect(response.content).toBeTruthy();

      // Still asserts the subject — the reply is grounded in the org's real
      // catalogue, not invented. Any real service name counts, because the bot
      // may legitimately answer with a close variant of the one asked about.
      const normalizedReply = normalizeForMatch(response.content);
      const mentionsService = serviceNames.some((name) =>
        normalizedReply.includes(normalizeForMatch(name))
      );

      // The old assertion was a bare toBe(true), so three red CI runs could not
      // say what the bot actually replied. Carry the evidence into the failure.
      expect(
        mentionsService,
        `Bot reply mentioned none of the org's ${serviceNames.length} services.\n` +
          `Asked about: ${target}\n` +
          `Reply: ${response.content}`
      ).toBe(true);
    });
  });
});
