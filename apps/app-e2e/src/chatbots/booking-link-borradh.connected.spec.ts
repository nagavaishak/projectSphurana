import { expect, test } from '@playwright/test';
import { SeedHelper, TEST_DATA } from '../fixtures/index.js';

test.describe('Chatbot — Borradh Booking Link', () => {
  test.setTimeout(120_000);

  let seed: SeedHelper;
  let orgId: string;
  let orgSlug: string;
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

    // Save original settings for cleanup
    originalSettings = await seed.authenticatedApiCall(
      'GET',
      '/organization/active'
    );
    orgSlug = (originalSettings as { slug?: string })?.slug ?? '';
    expect(
      orgSlug,
      'the booking link is built from the org slug — without one there is nothing to assert'
    ).toBeTruthy();
    await context.close();
  });

  test('bot includes borradh booking link when booking destination is borradh', async ({
    page,
    request,
  }) => {
    seed = new SeedHelper(page, request);
    const senderId = `e2e-sender-${Date.now()}-borradh-booking`;

    await test.step('set calendar type to borradh', async () => {
      await seed.updateOrganizationSettings(orgId, {
        bookingDestination: 'borradh',
        defaultBookingLink: null,
      });
    });

    let conversationId: string;

    await test.step('simulate webhook message', async () => {
      const result = await seed.simulateWebhook({
        platform: 'facebook_messenger',
        pageId: TEST_DATA.metaPageId,
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

      // The booking flow hangs off the MICROSITE base, on the marketing host,
      // and NAMES THE BRANCH: `/sites/{slug}/l/{branch}/book`. Claire resolves
      // the conversation's branch and quotes that branch's prices, so a
      // branch-less link would ask the customer a question she has the answer
      // to — and on a multi-branch clinic it lands them on the chooser after
      // being quoted one branch's price.
      //
      // Asserted as a REGEX with the segment in the middle, not as two
      // `toContain`s: `/sites/{slug}/book` is a substring of neither shape and
      // was what this test checked before, so it failed on a reply that was
      // correct. That is the second time this assertion has been outrun by the
      // link — see the previous note it replaces — which is why it now pins
      // the whole shape rather than a prefix of it.
      const content = response.content.toLowerCase();
      const slug = orgSlug.toLowerCase();

      // The expected shape is DERIVED from the org's actual branches rather
      // than assumed, so this cannot fail for the wrong reason on an org whose
      // branch count changes. `resolveConversationBranch` names a branch when
      // the conversation came from a branch-tagged ad or the org has exactly
      // one; otherwise it deliberately names none, and the link lands on the
      // chooser — safe, and the honest answer when nobody has said which
      // branch.
      const { items: branches } = (await seed.authenticatedApiCall(
        'GET',
        '/organization-locations'
      )) as { items: { id: string; slug: string | null }[] };

      // Stated as a PRECONDITION, not branched on. `resolveConversationBranch`
      // names a branch when the org has exactly one (or a branch-tagged ad
      // said which); with several and no ad it deliberately names none, and
      // the link lands on the chooser. This spec asserts the single-branch
      // case, so if the connected org ever gains a second branch this fails
      // with a sentence rather than silently testing something else.
      expect(
        branches,
        'this spec asserts the single-branch link shape — the connected org now has a different number of branches, so either seed it back to one or add a case for the chooser link'
      ).toHaveLength(1);

      const handle = (branches[0].slug ?? branches[0].id).toLowerCase();
      expect(content).toContain(`/sites/${slug}/l/${handle}/book`);

      // ...and never the retired top-level shape. That one only resolves via a
      // 301, and a link Claire sends a customer should not spend a redirect —
      // nor rely on one existing, which on a preview it does not.
      expect(content).not.toContain(`/book/${slug}`);
    });
  });

  test.afterAll(async ({ browser, request }) => {
    // Reset to original value
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
