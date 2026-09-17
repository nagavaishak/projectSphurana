import { type Locator, type Page, expect, test } from '@playwright/test';
import { SeedHelper, pickDate } from '../fixtures/index.js';

/**
 * Post Media to Social — Connected Org (apps/app)
 *
 * Tests posting generated videos and uploaded assets to Facebook and
 * Instagram via the content calendar Schedule Content dialog.
 *
 * Auth: connected-user — applied automatically via `connected` project
 * Timeout: 10 min per test
 *
 * Preconditions are SEEDED, never observed-and-skipped:
 *   - `setup-connected` seeds the Meta/Instagram integration
 *     (`seedConnectedMetaAdsIntegration`) and both media libraries
 *     (`ensureCreatedVideo` → Created Videos tab, `ensureUploadedVideo` →
 *     Uploaded Content tab).
 *   - Every helper below therefore ASSERTS its precondition. A missing page,
 *     a missing media card or the disconnected empty state is a regression and
 *     fails the test — it must never silently skip it.
 *
 * apps/app differences from apps/web-e2e:
 *   - Vite SPA, so no `waitUntil: 'domcontentloaded'` needed.
 *   - AddContentDialog defaults to the "Created Videos" tab (value="videos").
 *   - Selecting media fires `generateContent()`, which OVERWRITES the caption
 *     with the AI-generated one — so the tests never pre-fill the caption;
 *     they assert the AI populated it.
 *   - Clicking an event chip opens the shared post SIDE PANEL
 *     (`data-testid="side-panel"`), not a modal dialog.
 */

test.describe('Social Posts — Post Media to Social', () => {
  test.setTimeout(600_000);

  const scheduleContentButton = (page: Page) =>
    page.getByRole('button', { name: /schedule content/i });

  /**
   * Navigate to the content calendar and assert Meta IS connected (seeded by
   * setup-connected). The disconnected empty state here is a regression, not a
   * reason to skip.
   */
  async function gotoCalendar(page: Page, seed: SeedHelper): Promise<void> {
    await seed.gotoDashboardPage('/dashboard/content-calendar');

    await expect(scheduleContentButton(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Connect a social account')).toHaveCount(0);
  }

  /** Open the Schedule Content dialog. */
  async function openScheduleDialog(page: Page): Promise<Locator> {
    await scheduleContentButton(page).click();

    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    // The form is mounted (not just the shell) once its first field renders.
    await expect(dialog.getByLabel('Title')).toBeVisible({ timeout: 15_000 });
    return dialog;
  }

  /**
   * Select the first media card from a tab of the content picker.
   *
   * Both tabs are seeded by setup-connected, so an empty tab fails the test.
   * The card grid replaces a loading spinner, so a web-first visibility
   * assertion (which retries) is the wait — no sleeps, no isVisible() probes.
   */
  async function selectMedia(
    page: Page,
    dialog: Locator,
    tab: 'created videos' | 'uploaded content'
  ): Promise<void> {
    const tabLocator = dialog.getByRole('tab', { name: new RegExp(tab, 'i') });
    await expect(tabLocator).toBeVisible({ timeout: 15_000 });
    await tabLocator.click();
    await expect(tabLocator).toHaveAttribute('data-state', 'active');

    const mediaCard = dialog
      .locator('button')
      .filter({ has: page.locator('.aspect-video') })
      .first();
    await expect(mediaCard).toBeVisible({ timeout: 60_000 });
    await mediaCard.click();

    // The selected card renders a check badge over its thumbnail — proof the
    // form actually took the selection (mediaUrl is set).
    await expect(
      mediaCard.locator('.rounded-full.bg-primary').first()
    ).toBeVisible({ timeout: 15_000 });
  }

  /**
   * Select a connected page for `platform` from the Pages combobox.
   *
   * The combobox options are page NAMES — the platform is only encoded in the
   * option's icon (Facebook = text-blue-600, Instagram = text-pink-600), so
   * filter on the icon rather than on text that would never match.
   */
  async function selectSocialPage(
    page: Page,
    dialog: Locator,
    platform: 'facebook' | 'instagram'
  ): Promise<void> {
    // Absent when the org has no connected pages — a seeding regression.
    // The pages picker TRIGGER. Deliberately `button[role="combobox"]`, not
    // `getByRole('combobox')`: once the popover opens, cmdk renders its search
    // box (`<input role="combobox" placeholder="Search pages...">`) INSIDE the
    // dialog, so the bare role matches TWO elements and every later use of this
    // locator dies with a strict-mode violation. The trigger is a <button>, the
    // search box an <input>.
    const pagesButton = dialog.locator('button[role="combobox"]');
    await expect(pagesButton).toBeVisible({ timeout: 15_000 });
    await pagesButton.click();

    const iconClass =
      platform === 'facebook' ? '.text-blue-600' : '.text-pink-600';
    const option = page
      .locator('[cmdk-item]')
      .filter({ has: page.locator(iconClass) })
      .first();
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();

    // Trigger label flips off the placeholder once a page is selected.
    await expect(pagesButton).not.toContainText('Select pages');

    // Close the popover by clicking back into the form.
    await dialog.getByLabel('Title').click();
    await expect(option).toBeHidden();
  }

  /** Set a near-future schedule slot and submit. */
  async function scheduleAndSubmit(page: Page, dialog: Locator): Promise<void> {
    const futureDate = new Date();
    futureDate.setMinutes(futureDate.getMinutes() + 30);

    const timeStr = `${String(futureDate.getHours()).padStart(2, '0')}:${String(futureDate.getMinutes()).padStart(2, '0')}`;

    await pickDate(page, dialog, 'Date', futureDate);
    await dialog.getByLabel('Time').fill(timeStr);

    await dialog.getByRole('button', { name: /schedule content/i }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
  }

  /** Poll the real API until the scheduled post exists. */
  async function waitForSocialPost(
    seed: SeedHelper,
    postTitle: string
  ): Promise<{ id: string; title: string }> {
    let found: { id: string; title: string } | undefined;

    await expect
      .poll(
        async () => {
          const posts = await seed.listSocialPosts();
          found = posts.find((p) =>
            p.title?.toLowerCase().includes(postTitle.toLowerCase())
          );
          return Boolean(found);
        },
        {
          timeout: 30_000,
          message: `scheduled post "${postTitle}" never appeared via GET /social-posts`,
        }
      )
      .toBe(true);

    return found as { id: string; title: string };
  }

  /**
   * Verify the post was created (API + calendar chip), then delete it through
   * the UI (side panel → confirm) and verify it is gone from the API.
   *
   * The API delete in `finally` is a cleanup safety net for a failed assertion
   * above it — never a substitute for the UI path.
   */
  async function verifyAndCleanup(
    page: Page,
    seed: SeedHelper,
    postTitle: string
  ): Promise<void> {
    await seed.assertNoError('schedule social post');

    const created = await waitForSocialPost(seed, postTitle);

    try {
      const postOnCalendar = page.getByText(postTitle).first();
      await expect(postOnCalendar).toBeVisible({ timeout: 30_000 });
      await postOnCalendar.click();

      const panel = page.getByTestId('side-panel');
      await expect(panel).toHaveAttribute('data-state', 'open');

      await panel.getByRole('button', { name: 'Delete', exact: true }).click();

      const confirm = page.getByRole('alertdialog');
      // `SocialPostPanel` titles its confirm with the POST's own name —
      // `Delete “<post title>”?` (social-post-panel.tsx:435) — not a fixed
      // label. Asserting the title proves the confirm opened for THIS post
      // rather than some other row, and survives any rewording of the copy
      // around it.
      await expect(confirm).toBeVisible({ timeout: 10_000 });
      await expect(confirm).toContainText(postTitle, { timeout: 10_000 });
      await confirm
        .getByRole('button', { name: 'Delete', exact: true })
        .click();

      await expect
        .poll(
          async () => {
            const posts = await seed.listSocialPosts();
            return posts.some((p) => p.id === created.id);
          },
          {
            timeout: 30_000,
            message: `post "${postTitle}" still exists after deleting it from the side panel`,
          }
        )
        .toBe(false);
    } finally {
      await seed.deleteSocialPost(created.id).catch(() => undefined);
    }
  }

  /**
   * The four tests below are the same flow across the media-source ×
   * platform matrix. They are deliberately kept as four independent tests so a
   * failure names the exact combination that broke.
   */

  // ────────────────────────────────────────────────────────────────
  // Test A: Generated video → Facebook
  // ────────────────────────────────────────────────────────────────

  test('posts generated video to Facebook', async ({ page, request }) => {
    const seed = new SeedHelper(page, request);
    const postTitle = `E2E FB Video ${Date.now()}`;

    await gotoCalendar(page, seed);
    const dialog = await openScheduleDialog(page);

    await test.step('fill title', async () => {
      await dialog.getByLabel('Title').fill(postTitle);
    });

    await test.step('select media — Created Videos tab', async () => {
      await selectMedia(page, dialog, 'created videos');
    });

    await test.step('caption is auto-populated by AI from the selection', async () => {
      // The caption was left EMPTY above, so a non-blank value here can only
      // have come from generateContent() reacting to the media selection.
      await expect(dialog.getByLabel('Caption')).toHaveValue(/\S/, {
        timeout: 120_000,
      });
    });

    await test.step('select Facebook page', async () => {
      await selectSocialPage(page, dialog, 'facebook');
    });

    await test.step('schedule and submit', async () => {
      await scheduleAndSubmit(page, dialog);
    });

    await test.step('verify and cleanup', async () => {
      await verifyAndCleanup(page, seed, postTitle);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Test B: Generated video → Instagram
  // ────────────────────────────────────────────────────────────────

  test('posts generated video to Instagram', async ({ page, request }) => {
    const seed = new SeedHelper(page, request);
    const postTitle = `E2E IG Video ${Date.now()}`;

    await gotoCalendar(page, seed);
    const dialog = await openScheduleDialog(page);

    await test.step('fill title', async () => {
      await dialog.getByLabel('Title').fill(postTitle);
    });

    await test.step('select media — Created Videos tab', async () => {
      await selectMedia(page, dialog, 'created videos');
    });

    await test.step('caption is auto-populated by AI from the selection', async () => {
      await expect(dialog.getByLabel('Caption')).toHaveValue(/\S/, {
        timeout: 120_000,
      });
    });

    await test.step('select Instagram page', async () => {
      await selectSocialPage(page, dialog, 'instagram');
    });

    await test.step('schedule and submit', async () => {
      await scheduleAndSubmit(page, dialog);
    });

    await test.step('verify and cleanup', async () => {
      await verifyAndCleanup(page, seed, postTitle);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Test C: Uploaded video → Facebook
  // ────────────────────────────────────────────────────────────────

  test('posts uploaded video to Facebook', async ({ page, request }) => {
    const seed = new SeedHelper(page, request);
    const postTitle = `E2E FB Asset ${Date.now()}`;

    await gotoCalendar(page, seed);
    const dialog = await openScheduleDialog(page);

    await test.step('fill title', async () => {
      await dialog.getByLabel('Title').fill(postTitle);
    });

    await test.step('select media — Uploaded Content tab', async () => {
      await selectMedia(page, dialog, 'uploaded content');
    });

    await test.step('caption is auto-populated by AI from the selection', async () => {
      await expect(dialog.getByLabel('Caption')).toHaveValue(/\S/, {
        timeout: 120_000,
      });
    });

    await test.step('select Facebook page', async () => {
      await selectSocialPage(page, dialog, 'facebook');
    });

    await test.step('schedule and submit', async () => {
      await scheduleAndSubmit(page, dialog);
    });

    await test.step('verify and cleanup', async () => {
      await verifyAndCleanup(page, seed, postTitle);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Test D: Uploaded video → Instagram
  // ────────────────────────────────────────────────────────────────

  test('posts uploaded video to Instagram', async ({ page, request }) => {
    const seed = new SeedHelper(page, request);
    const postTitle = `E2E IG Asset ${Date.now()}`;

    await gotoCalendar(page, seed);
    const dialog = await openScheduleDialog(page);

    await test.step('fill title', async () => {
      await dialog.getByLabel('Title').fill(postTitle);
    });

    await test.step('select media — Uploaded Content tab', async () => {
      await selectMedia(page, dialog, 'uploaded content');
    });

    await test.step('caption is auto-populated by AI from the selection', async () => {
      await expect(dialog.getByLabel('Caption')).toHaveValue(/\S/, {
        timeout: 120_000,
      });
    });

    await test.step('select Instagram page', async () => {
      await selectSocialPage(page, dialog, 'instagram');
    });

    await test.step('schedule and submit', async () => {
      await scheduleAndSubmit(page, dialog);
    });

    await test.step('verify and cleanup', async () => {
      await verifyAndCleanup(page, seed, postTitle);
    });
  });
});
