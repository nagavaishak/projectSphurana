import { expect, test } from '@playwright/test';

// Smoke tests for the Claire assistant chat page (CA-2 port). The
// `authenticated` project loads bare-user storageState, so each test can
// navigate straight to the route.
//
// The route renders EITHER the product (conversation list / chat composer) or
// the FreeTierGate upsell — `/assistant` shows FreeTierGate only when the
// org's plan has `hasAssistantAccess: false`, i.e. the `free` plan (see
// packages/features/src/assistant/models/plan-limits.ts). The bare test org is
// pre-seeded WITH an active paid subscription (see setup-bare.ts), so the
// product is the ONLY correct outcome here. Accepting the gate as a pass would
// let a total loss of Claire access ship green — assert the product.

test.describe('assistant chat page', () => {
  test('/assistant renders the conversation list', async ({ page }) => {
    await page.goto('/assistant');

    // Cold Vite dev + auth resolution can keep `#root` empty for 10–15s.
    // Wait for the AssistantProductLayout sidebar to confirm the route shell
    // mounted before asserting the inner content.
    await page
      .locator('[data-sidebar="menu-button"]')
      .first()
      .waitFor({ timeout: 30_000 });

    await expect(
      page.getByRole('heading', { name: 'Conversations', exact: true })
    ).toBeVisible({ timeout: 15_000 });
    // The paywall must NOT be what we're looking at.
    await expect(page.getByText(/what claire does once she's in/i)).toHaveCount(
      0
    );
  });

  test('/assistant?new=1 shows the chat composer', async ({ page }) => {
    // TanStack Router's default search parser runs JSON.parse on each value,
    // so `?new=1` parses to the number 1 and trips the route's
    // `z.string().optional()` schema. Wrapping in quotes (`"1"`) parses to the
    // string "1" — what the route component compares against.
    await page.goto('/assistant?new=%221%22');
    await page
      .locator('[data-sidebar="menu-button"]')
      .first()
      .waitFor({ timeout: 30_000 });

    // ChatContainer renders a PromptInputTextarea (role=textbox). A paid org
    // must get the composer, never the FreeTierGate.
    await expect(page.getByRole('textbox').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/what claire does once she's in/i)).toHaveCount(
      0
    );
  });
});
