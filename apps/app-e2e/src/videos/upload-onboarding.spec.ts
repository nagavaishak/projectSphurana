import { expect, test } from '@playwright/test';
import { branchUrlPattern } from '../fixtures/branch.fixture.js';
import { SeedHelper } from '../fixtures/index.js';
import { getTestVideo } from '../fixtures/test-assets.fixture.js';

/**
 * Upload a video via the onboarding /upload-assets funnel.
 *
 * Resolves the test video via TEST_VIDEO_DIR env var or CDN download, uploads
 * it, then walks the funnel's three fixed steps (upload → review-supplementary
 * → review-talking-head; see upload-funnel.tsx). Every step always renders —
 * each handles its own empty state — so the walk is asserted, not probed.
 */

/**
 * Resolve the test video, or fail loudly. An unavailable asset is a broken
 * harness, not a reason to pass.
 */
async function requireTestVideo(filename: string): Promise<string> {
  const resolved = await getTestVideo(filename);
  if (!resolved) {
    throw new Error(
      `Test video "${filename}" could not be resolved. Set TEST_VIDEO_DIR to a directory containing it, or make it downloadable from TEST_ASSETS_URL.`
    );
  }
  return resolved;
}

test.describe('Onboarding — Upload Assets', () => {
  test.setTimeout(600_000); // 10 minutes — upload + slow AI analysis on local tunnel

  test('uploads a video through the onboarding funnel', async ({
    page,
    request,
  }) => {
    const videoPath = await requireTestVideo('procedure1.mp4');
    const seed = new SeedHelper(page, request);

    await test.step('Navigate to upload-assets', async () => {
      await seed.gotoProtectedPage('/upload-assets');
      await expect(page.getByText(/upload your assets/i)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step('Drop file into dropzone', async () => {
      // apps/app uses react-dropzone too — Playwright's setInputFiles is not
      // reliable. Use the UploadProvider's __e2eAddFiles bridge.
      await seed.uploadFilesViaDropzone([videoPath]);
    });

    await test.step('Wait for upload and AI analysis', async () => {
      // Confirm the upload registered — the "X of Y analyzed" badge appears as
      // soon as the file enters the queue and persists through analysis. The
      // transient "Uploading…" copy on each row can flicker through fast
      // enough that asserting on it races on the local tunnel.
      await expect(page.getByText(/of.*analyzed/i).first()).toBeVisible({
        timeout: 15_000,
      });

      // The "Continue to Review" button is gated on isAllAnalysisComplete &&
      // totalCount > 0 (apps/app/.../upload-funnel.tsx). Waiting for it to be
      // enabled is the most reliable signal that analysis finished — survives
      // pluralization changes in the "X of Y analyzed" badge.
      await expect(
        page.getByRole('button', { name: /continue to review/i })
      ).toBeEnabled({ timeout: 480_000 });
    });

    await test.step('Step 1 — Review Supplementary Assets', async () => {
      await page.getByRole('button', { name: /continue to review/i }).click();

      await expect(
        page.getByRole('heading', { name: /review supplementary assets/i })
      ).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: /^continue$/i }).click();
    });

    // Review Talking Head is now the LAST step, so its button is the funnel's
    // submit ("Complete"), not "Continue". The Before & After Pairing step that
    // used to follow was removed with the before/after format
    // (RETIRED_TEMPLATE_IDS): we cannot confirm two photos show the same client
    // and treatment, so the pairing is no longer collected.
    await test.step('Step 2 — Review Talking Head, then Complete', async () => {
      await expect(
        page.getByRole('heading', { name: /review talking head/i })
      ).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: /^complete$/i }).click();
    });

    await test.step('Verify redirect to the gallery', async () => {
      // The upload funnel finishes on /dashboard/marketing/gallery
      // (upload-funnel.tsx) — the old /dashboard/content home is a redirect.
      await page.waitForURL(branchUrlPattern('marketing/gallery'), {
        timeout: 15_000,
      });
    });
  });
});
