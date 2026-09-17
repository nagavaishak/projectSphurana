import { expect, test } from '@playwright/test';
import { branchUrl, branchUrlPattern } from '../fixtures/branch.fixture.js';

/**
 * Chatbot config E2E (apps/app).
 *
 * The chatbot UI has moved twice: apps/web's dedicated playground → the
 * settings area → and now the **AI Assistant** page, which is the single place
 * an owner tunes the assistant. `/dashboard/chatbots` and
 * `/dashboard/settings/chatbot` are both redirects to `/dashboard/ai-assistant`.
 *
 * Route: /dashboard/ai-assistant
 * Auth: bare org (no Meta connected) — `authenticated` project / storageState.
 *
 * Layout (apps/app/src/routes/_authed/dashboard/ai-assistant.tsx):
 *   - Left: DirectiveCard — a "Chatbot Instructions" label + the `#directive`
 *     textarea, with "Test chatbot" and "Save" buttons floating in its corner.
 *   - Right: a "Channels" card (where the bot replies), the voice panel and the
 *     test-call card.
 *   - The test chat is NOT inline any more — "Test chatbot" opens it in a
 *     Dialog, so every test-chat assertion has to open that dialog first.
 *
 * NOTE on selectors:
 *   - `#directive` is the only directive textarea; it is the mount signal (the
 *     org query has to resolve before DirectiveCard renders).
 *   - The DirectiveCard save button is exactly "Save" (the voice panel's is
 *     "Save voice"), so `{ exact: true }` is unambiguous.
 */

// Force serial within the file. The AI-assistant page makes a stack of queries
// (runtime-config + session + active-org + voice script + channels) that each
// cold-boot of the Vite SPA needs to resolve before #directive mounts. When the
// file's tests run in parallel against the local tunnel, the later ones starve
// and the beforeEach #directive wait blows past 60s. Serial keeps them fast and
// reliable — other spec files still run in parallel via project-level
// fullyParallel.
test.describe.configure({ mode: 'serial' });

const AI_ASSISTANT_PATH = '/dashboard/ai-assistant';

/** Open the test chat (it lives behind the DirectiveCard's "Test chatbot" button). */
async function openTestChat(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /test chatbot/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByPlaceholder('Type a message...')).toBeVisible({
    timeout: 15_000,
  });
  return dialog;
}

test.describe('Chatbot Settings (apps/app)', () => {
  // Bumped from the project default (60s). Under sustained load the save +
  // reload test needs more than 60s; 120s leaves headroom even when other
  // spec files are running in parallel workers.
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto(await branchUrl(page, AI_ASSISTANT_PATH), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    // Wait for DirectiveCard to mount (the org query resolves before render).
    // Bumped to 60s — under parallel load on the local tunnel the org fetch +
    // skeleton-to-card swap can stretch past 30s.
    await expect(page.locator('#directive')).toBeVisible({ timeout: 60_000 });
  });

  test('page loads with chatbot config and test chat', async ({ page }) => {
    // The directive editor…
    await expect(page.getByText('Chatbot Instructions')).toBeVisible({
      timeout: 10_000,
    });
    // …and its test-chat entry point.
    await expect(
      page.getByRole('button', { name: /test chatbot/i })
    ).toBeVisible();
  });

  test('the legacy chatbot routes still land here', async ({ page }) => {
    // Old deep links (bookmarks, docs, emails) must not 404.
    for (const legacy of [
      '/dashboard/chatbots',
      '/dashboard/settings/chatbot',
    ]) {
      await page.goto(legacy, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await expect(page).toHaveURL(branchUrlPattern('ai-assistant'), {
        timeout: 20_000,
      });
    }
  });

  test('test chat shows empty state and functional input', async ({ page }) => {
    const dialog = await openTestChat(page);

    await expect(
      dialog.getByText('Send a message to test your chatbot.').first()
    ).toBeVisible();

    const messageInput = dialog.getByPlaceholder('Type a message...');
    await expect(messageInput).toBeVisible();

    // The floating Claire assistant widget (when its PostHog flag is on) also
    // renders a lucide-send button — scoping to the dialog is what separates
    // them; the test chat has exactly one send button inside it.
    const sendButton = dialog
      .getByRole('button')
      .filter({ has: page.locator('svg.lucide-send') });

    // Send button disabled when empty.
    await expect(sendButton).toBeDisabled();

    // Enables when text entered.
    await messageInput.fill('Hello');
    await expect(messageInput).toHaveValue('Hello');
    await expect(sendButton).toBeEnabled({ timeout: 15_000 });
  });

  test('configuration shows directive textarea', async ({ page }) => {
    await expect(page.getByText('Chatbot Instructions')).toBeVisible();
    await expect(page.locator('#directive')).toBeVisible();
  });

  test('can save directive changes and they persist', async ({ page }) => {
    // The DirectiveCard's Save button (the voice panel's is "Save voice", so an
    // exact "Save" is unambiguous); disabled until hasChanges flips.
    const saveButton = page.getByRole('button', { name: 'Save', exact: true });
    await expect(saveButton).toBeDisabled();

    // Edit directive — save button enables.
    const timestamp = Date.now();
    const directive = `E2E test directive ${timestamp}`;
    await page.locator('#directive').fill(directive);
    await expect(saveButton).toBeEnabled();

    // Save — wait for the success toast to confirm the mutation landed
    // (saveButton flips back to disabled once the org cache invalidates, but
    // the toast is the unambiguous "persisted" signal).
    await saveButton.click();
    await expect(page.getByText(/chatbot settings updated/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(saveButton).toBeDisabled({ timeout: 10_000 });

    // Reload and verify persistence.
    await page.goto(await branchUrl(page, AI_ASSISTANT_PATH), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    // Wait for the textarea to mount AND for the org query to populate its
    // value — generous timeout because cold-boot on the local tunnel takes
    // ~10-15s before useActiveOrganization resolves.
    await expect(page.locator('#directive')).toHaveValue(
      new RegExp(String(timestamp)),
      { timeout: 30_000 }
    );
  });

  test('channels section shows no connected pages', async ({ page }) => {
    await expect(page.getByText('Channels')).toBeVisible();

    // Bare org has no Meta/Instagram/WhatsApp, so ChatbotPageToggles renders its
    // "No pages or accounts found..." empty state — deterministic, not a
    // maybe-this-maybe-that.
    //
    // This MUST be an auto-retrying assertion: the card renders a skeleton until
    // the pages + IG + WhatsApp queries resolve, and `locator.isVisible()` (what
    // this used to call) does NOT wait — its `timeout` is ignored — so it raced
    // the skeleton and flaked whenever the API was slow.
    await expect(
      page.getByText(/no pages or accounts found/i).first()
    ).toBeVisible({ timeout: 30_000 });
  });

  test('responsive: mobile renders the directive and test chat', async ({
    page,
  }) => {
    // On mobile the two columns stack; the sidebar collapses into a Sheet
    // trigger, so don't wait for `[data-sidebar="menu-button"]` — wait for the
    // in-page content instead.
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(await branchUrl(page, AI_ASSISTANT_PATH), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    // Directive textarea confirms the org loaded and DirectiveCard mounted.
    await expect(page.locator('#directive')).toBeVisible({ timeout: 30_000 });
    // The test chat is reachable at this width too.
    await openTestChat(page);
  });
});
