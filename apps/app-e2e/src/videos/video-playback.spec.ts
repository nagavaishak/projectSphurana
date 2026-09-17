import { expect, test } from '@playwright/test';
import { SeedHelper } from '../fixtures/index.js';

/**
 * Video Playback E2E Test
 *
 * Seeds a ready AI-generated video, then verifies that clicking it on the
 * videos page opens the preview dialog and the video actually plays.
 *
 * The seed makes the "AI Generated" tab deterministic — no probing for whether
 * a playable video happens to exist, and no falling back to the uploaded tab.
 */

test.describe('Video Playback', () => {
  test.setTimeout(180_000);

  test('clicking a video opens preview and plays it', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);

    // Seeds a status='ready' ai-generated video with a playable blobUrl.
    // Idempotent — no-ops if one already exists.
    await seed.ensureCreatedVideo();

    await seed.gotoDashboardPage('/dashboard/marketing/gallery/videos');

    await page.getByRole('tab', { name: /ai generated/i }).click();

    // The seeded video renders a card with a "Ready" badge.
    const videoCard = page
      .locator('[role="button"]')
      .filter({ has: page.getByText('Ready') })
      .first();
    await expect(videoCard).toBeVisible({ timeout: 30_000 });
    await videoCard.click();

    // The preview dialog should open
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // A <video> element with controls should appear inside the dialog
    const videoElement = dialog.locator('video[controls]');
    await expect(videoElement).toBeVisible({ timeout: 30_000 });

    // Verify the video has a src (presigned URL was fetched)
    await expect(videoElement).toHaveAttribute('src', /.+/, {
      timeout: 15_000,
    });

    // Play the video and verify playback actually advances.
    await videoElement.evaluate((video: HTMLVideoElement) => video.play());

    await expect
      .poll(
        () =>
          videoElement.evaluate((video: HTMLVideoElement) => video.currentTime),
        {
          timeout: 20_000,
          intervals: [250, 500, 1_000],
          message: 'video currentTime should advance past 0 once playing',
        }
      )
      .toBeGreaterThan(0);
  });
});
