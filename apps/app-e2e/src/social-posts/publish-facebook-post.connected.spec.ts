import { expect, test } from '@playwright/test';
import {
  SeedHelper,
  TEST_ASSETS_BASE_URL,
  pickDate,
} from '../fixtures/index.js';

/**
 * Schedule a Facebook Post — Connected Org (apps/app)
 *
 * Creates a real social post via the content calendar's Schedule Content
 * dialog, asserts it renders on the calendar AND exists via the API, then
 * deletes it through the post side-panel.
 *
 * NOTE ON NAMING: this spec does not *publish* to Facebook. It schedules a
 * post ~30 minutes out and deletes it well before the publisher picks it up —
 * nothing is ever pushed to the live Page. `schedule-facebook-post` would be
 * the honest name.
 *
 * Preconditions are SEEDED and ASSERTED, never observed-and-skipped:
 *   - an active Facebook page on the connected org's Meta integration
 *     (seeded by setup-connected → /testing/seed-meta-ads); missing = HARD FAIL
 *   - one uniquely-named image asset, seeded via POST /assets, so the content
 *     picker always has a deterministic item to select
 *
 * Auth: connected-user — applied automatically via the `connected` project.
 */

const TITLE_PREFIX = 'E2E FB Post';
const ASSET_PREFIX = 'E2E FB Asset';

interface MetaPage {
  id: string;
  pageId: string;
  pageName: string | null;
  platform: string;
  isActive: boolean;
}

/**
 * Resolve the connected org's active page for `platform`.
 *
 * Hard-fails when there isn't one. A missing page is a broken precondition of
 * the `connected` project (its Meta integration is seeded in setup-connected),
 * i.e. exactly the regression this spec exists to catch — not an environmental
 * constraint to skip on.
 */
async function requireActivePage(
  seed: SeedHelper,
  platform: 'facebook' | 'instagram'
): Promise<{ id: string; label: string }> {
  const result = (await seed.authenticatedApiCall(
    'GET',
    '/integrations/meta-ads/pages'
  )) as { pages?: MetaPage[] };
  const pages = result.pages ?? [];
  const match = pages.find((p) => p.platform === platform && p.isActive);

  if (!match) {
    const seen =
      pages
        .map((p) => `${p.platform}:${p.pageName ?? p.pageId}:${p.isActive}`)
        .join(', ') || 'none';
    throw new Error(
      `Connected org has no active ${platform} page — GET /integrations/meta-ads/pages returned: ${seen}. setup-connected seeds the Meta integration (TEST_META_ACCESS_TOKEN / TEST_META_PAGE_ID / TEST_META_AD_ACCOUNT_ID); fix the connection rather than skipping the test.`
    );
  }

  return { id: match.id, label: match.pageName ?? match.pageId };
}

/**
 * Seed one uniquely-named image asset so the "Uploaded Content" tab always has
 * a deterministic item — no probing the picker for whatever happens to be
 * there, no upload fallback, no self-skip when the org is empty.
 */
async function seedImageAsset(
  seed: SeedHelper,
  name: string
): Promise<{ id: string; name: string }> {
  // A CLONE, not the shared fixture: `cleanupArtifacts` deletes this asset, and
  // `DELETE /assets/:id` hard-deletes the S3 object behind its blobUrl. Seeding
  // straight off the shared fixture is how that fixture kept being deleted out
  // from under every other suite. See SeedHelper.cloneFixtureUrl.
  const blobUrl = await seed.cloneFixtureUrl(
    `${TEST_ASSETS_BASE_URL}/test-image.jpg`
  );

  const created = (await seed.authenticatedApiCall('POST', '/assets', {
    name,
    blobUrl,
    type: 'image',
    source: 'edited',
    tags: [],
  })) as { id?: string; name?: string };

  if (!created?.id) {
    throw new Error(
      `Failed to seed image asset via POST /assets: ${JSON.stringify(created)}`
    );
  }
  return { id: created.id, name: created.name ?? name };
}

/** Delete every artefact this spec creates (and any orphan from a failed run). */
async function cleanupArtifacts(seed: SeedHelper): Promise<void> {
  const posts = await seed.listSocialPosts();
  await Promise.all(
    posts
      .filter((p) => p.title?.startsWith(TITLE_PREFIX))
      .map((p) => seed.deleteSocialPost(p.id))
  );

  const assets = await seed.listAssets();
  await Promise.all(
    assets
      .filter((a) => a.name?.startsWith(ASSET_PREFIX))
      .map((a) => seed.authenticatedApiCall('DELETE', `/assets/${a.id}`))
  );
}

/** 30 minutes out — future enough for the schedule to be valid, far enough that the publisher never fires before cleanup. */
function scheduleSlot(): Date {
  const slot = new Date();
  slot.setMinutes(slot.getMinutes() + 30);
  return slot;
}

function timeValue(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

test.describe('Social Posts — Facebook', () => {
  test.setTimeout(600_000);

  test.afterEach(async ({ page, request }) => {
    await cleanupArtifacts(new SeedHelper(page, request));
  });

  test('schedules a Facebook post and cleans up', async ({ page, request }) => {
    const seed = new SeedHelper(page, request);
    const stamp = Date.now();
    const postTitle = `${TITLE_PREFIX} ${stamp}`;
    const caption = `E2E test post — will be deleted ${stamp}`;
    const assetName = `${ASSET_PREFIX} ${stamp}`;
    const scheduledFor = scheduleSlot();

    const dialog = page.locator('[role="dialog"]');
    const captionField = dialog.getByLabel('Caption');
    const contentError = dialog
      .locator('[data-slot="field-error"]')
      .filter({ hasText: /select content/i });
    const sidePanel = page.getByTestId('side-panel');

    const facebookPage = await requireActivePage(seed, 'facebook');
    const asset = await seedImageAsset(seed, assetName);

    await test.step('open the Schedule Content dialog', async () => {
      await seed.gotoDashboardPage('/dashboard/content-calendar');

      const scheduleBtn = page.getByRole('button', {
        name: /schedule content/i,
      });
      await expect(scheduleBtn).toBeVisible({ timeout: 30_000 });
      await scheduleBtn.click();

      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(
        dialog.getByRole('heading', { name: 'Schedule Content' })
      ).toBeVisible();
    });

    await test.step('fill the title', async () => {
      await dialog.getByLabel('Title').fill(postTitle);
      await expect(dialog.getByLabel('Title')).toHaveValue(postTitle);
    });

    await test.step('select the seeded image from Uploaded Content', async () => {
      await dialog.getByRole('tab', { name: /uploaded content/i }).click();
      await dialog.getByPlaceholder('Search content...').fill(asset.name);

      const card = dialog
        .locator('[role="tabpanel"] button')
        .filter({ hasText: asset.name });
      await expect(card).toBeVisible({ timeout: 30_000 });

      // Selecting media kicks off AI caption generation, which writes into the
      // caption field when it lands. Wait for it to settle before typing, or it
      // clobbers the caption a moment after we fill it.
      const generation = page.waitForResponse(
        (res) => res.url().includes('ai-content/generate'),
        { timeout: 120_000 }
      );
      await card.click();

      // The card takes the selected ring once form.mediaUrl === asset.blobUrl.
      await expect(card).toHaveClass(/border-primary/);
      await expect(contentError).toBeHidden();

      await generation;
      // The AI overlay hides (and the textarea un-hides) only after React has
      // applied the generated caption — so our fill below is guaranteed to win.
      await expect(dialog.getByText('Generating...')).toBeHidden({
        timeout: 60_000,
      });
    });

    await test.step('fill the caption', async () => {
      await expect(captionField).toBeVisible();
      await captionField.fill(caption);
      await expect(captionField).toHaveValue(caption);
    });

    await test.step('select the Facebook page', async () => {
      // The pages picker TRIGGER. Deliberately `button[role="combobox"]`, not
      // `getByRole('combobox')`: once the popover opens, cmdk renders its search
      // box (`<input role="combobox" placeholder="Search pages...">`) INSIDE the
      // dialog, so the bare role matches TWO elements and every later use of this
      // locator dies with a strict-mode violation. The trigger is a <button>, the
      // search box an <input>.
      const pagesButton = dialog.locator('button[role="combobox"]');
      await pagesButton.click();

      const option = page
        .locator('[cmdk-item]')
        .filter({ hasText: facebookPage.label });
      await expect(option).toBeVisible({ timeout: 15_000 });
      await option.click();
      await page.keyboard.press('Escape');

      // With exactly one page selected the trigger renders that page's name.
      await expect(pagesButton).toContainText(facebookPage.label);
    });

    await test.step('set the schedule time', async () => {
      await pickDate(page, dialog, 'Date', scheduledFor);
      await dialog.getByLabel('Time').fill(timeValue(scheduledFor));
      await expect(dialog.getByLabel('Time')).toHaveValue(
        timeValue(scheduledFor)
      );
    });

    await test.step('submit the post', async () => {
      const submitBtn = dialog.getByRole('button', {
        name: /schedule content/i,
      });
      await submitBtn.scrollIntoViewIfNeeded();
      await submitBtn.click();

      // A successful create closes the dialog; a rejected one keeps it open
      // (with the field errors / error toast that caused it).
      await expect(dialog).toBeHidden({ timeout: 60_000 });
      await expect(
        page.locator('[data-sonner-toast][data-type="error"]')
      ).toHaveCount(0);
    });

    await test.step('the post renders on the content calendar', async () => {
      // THE assertion of this test: the post must actually appear in the UI.
      // (The API read-back below is only a backstop — on its own it let a
      // never-rendering post pass.)
      await expect(page.getByText(postTitle).first()).toBeVisible({
        timeout: 30_000,
      });
    });

    await test.step('the post exists via the API as scheduled (backstop)', async () => {
      const posts = await seed.listSocialPosts();
      const created = posts.find((p) => p.title === postTitle);
      expect(
        created,
        `GET /social-posts returned no post titled "${postTitle}"`
      ).toBeTruthy();
      expect(created?.status).toBe('scheduled');
    });

    await test.step('delete the post from the calendar UI', async () => {
      await page.getByText(postTitle).first().click();

      await expect(sidePanel).toHaveAttribute('data-state', 'open');
      await expect(
        sidePanel.getByRole('heading', { name: postTitle })
      ).toBeVisible();

      await sidePanel.getByRole('button', { name: /^delete$/i }).click();

      const confirm = page.getByRole('alertdialog');
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: /^delete$/i }).click();

      await expect(page.getByText(postTitle)).toHaveCount(0, {
        timeout: 30_000,
      });
    });
  });
});
