import { type Page, expect, test } from '@playwright/test';

/**
 * Claire-on-WhatsApp — owner flow (WS-12, Phase 4 E2E scaffold).
 *
 * Documents and (when fully provisioned) exercises the end-to-end owner journey
 * described in the plan §8 / progress doc OPERATOR GO-LIVE checklist:
 *
 *   1. Owner opens Claire settings → WhatsApp → Connect → pairs by sending the
 *      6-digit code to the DEDICATED Claire number.
 *   2. Owner texts "create a campaign" → Claire replies with the creative
 *      (image/video) + a text summary + a "reply *launch*" CTA.
 *   3. Owner replies "launch" → the ad publishes; Claire confirms.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * OPERATOR SETUP REQUIRED (plan §0). This spec is `test.skip`-guarded so CI
 * stays GREEN without the real number. To run it for real you MUST set, in the
 * e2e environment:
 *   - CLAIRE_WHATSAPP_NUMBER          the dedicated Claire WABA number (E.164)
 *   - CLAIRE_WHATSAPP_PHONE_NUMBER_ID the dedicated number's phone_number_id
 *   - CLAIRE_WHATSAPP_ACCESS_TOKEN    a system-user token for that number
 *   - CLAIRE_WHATSAPP_ENABLED=true    on the API + worker under test
 * AND drive a real WhatsApp client (the steps 1–3 above cannot be done by a
 * browser — they require sending/receiving messages on the dedicated number).
 *
 * Because the pairing round-trip + inbound turn happen over a real WhatsApp
 * client (not the browser), the live assertions are documented here and the
 * pipeline is otherwise validated headlessly by the API integration spec
 * `apps/api/src/chatbot-worker/claire-whatsapp-turn.process.spec.ts` and the
 * seed endpoint `POST /testing/simulate-claire-whatsapp-turn`.
 *
 * Auth: bare-user (the pairing card lives in Claire settings) — applied by the
 *   `authenticated` project via storageState.
 */

// Gate: the real dedicated Claire number + creds must be present. Absent in CI.
const hasClaireNumber =
  !!process.env.CLAIRE_WHATSAPP_NUMBER &&
  !!process.env.CLAIRE_WHATSAPP_PHONE_NUMBER_ID &&
  !!process.env.CLAIRE_WHATSAPP_ACCESS_TOKEN;

async function expectClaireWhatsAppPage(page: Page) {
  await expect(
    page.getByRole('heading', { name: /claire settings/i })
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('heading', { name: /claire on whatsapp/i })
  ).toBeVisible({ timeout: 15_000 });
}

test.describe('Claire on WhatsApp — owner flow', () => {
  test.setTimeout(180_000);

  test('pairing card renders Connect (or already-connected) state', async ({
    page,
  }) => {
    // This UI-only assertion runs ALWAYS (no real number needed): the pairing
    // card is the entry point to the whole flow and must be reachable.
    await page.goto('/settings/claire/whatsapp');
    // /settings/claire/* uses a standalone layout with NO global app sidebar
    // (see routes/_authed/settings/claire.tsx) — anchor on the layout's own
    // headings instead of the usual sidebar wait.
    await expectClaireWhatsAppPage(page);

    // The card title is constant in every state (pending/active/disconnected).
    await expect(page.getByText(/claire on whatsapp/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // One of: "Connect WhatsApp" (unpaired) | "Connected" badge (paired).
    await expect(
      page
        .getByRole('button', { name: /connect whatsapp/i })
        .or(page.getByText(/connected/i).first())
    ).toBeVisible({ timeout: 15_000 });
  });

  test('owner pairs, creates a campaign, and launches over WhatsApp', async ({
    page,
  }) => {
    test.skip(
      !hasClaireNumber,
      'Requires a dedicated Claire WhatsApp number + creds (CLAIRE_WHATSAPP_NUMBER / _PHONE_NUMBER_ID / _ACCESS_TOKEN). See plan §0 — operator setup.'
    );

    // ── Step 1: start pairing in the UI ────────────────────────────────────
    await page.goto('/settings/claire/whatsapp');
    // /settings/claire/* uses a standalone layout with NO global app sidebar
    // (see routes/_authed/settings/claire.tsx) — anchor on the layout's own
    // headings instead of the usual sidebar wait.
    await expectClaireWhatsAppPage(page);

    await test.step('start pairing → a 6-digit code + wa.me link appears', async () => {
      await page.getByRole('button', { name: /connect whatsapp/i }).click();
      // The card shows the code and an "Open WhatsApp" deep link while pending.
      await expect(page.getByText(/waiting for your message/i)).toBeVisible({
        timeout: 15_000,
      });
      const code = await page.locator('.font-mono').first().innerText();
      expect(code.trim()).toMatch(/^\d{6}$/);

      // ── Step 1b (OPERATOR / real WhatsApp client) ───────────────────────
      // Send `code` as a WhatsApp message to CLAIRE_WHATSAPP_NUMBER from the
      // owner's handset (or a Meta test number). The webhook verifies the
      // code, stamps the phone, flips the link to `active`, and replies
      // "You're all set!". The card then polls to the connected state:
      await expect(page.getByText(/connected/i).first()).toBeVisible({
        timeout: 120_000,
      });
    });

    // ── Step 2 (OPERATOR / real WhatsApp client): create a campaign ─────────
    // From the owner's handset, text "create a campaign" to the Claire number.
    // EXPECTED inbound to the owner (assert on the real device or via a webhook
    // tap): an image/video media message, a text summary (headline + targeting
    // + "Still needed: …"), and a CTA text "Reply *launch* to publish…".
    //
    //   await expectOwnerReceivesMedia();
    //   await expectOwnerReceivesText(/still needed|targeting|headline/i);
    //   await expectOwnerReceivesText(/reply \*?launch\*? to publish/i);

    // ── Step 3 (OPERATOR / real WhatsApp client): launch ────────────────────
    // Text "launch" to the Claire number.
    // EXPECTED: the ad publishes (visible in the Ads dashboard) and Claire
    // confirms over WhatsApp ("your campaign is live").
    //
    //   await page.goto('/dashboard/advertising');
    //   await expect(page.getByText(/active|live/i)).toBeVisible();
    //   await expectOwnerReceivesText(/live|published|launched/i);
  });
});
