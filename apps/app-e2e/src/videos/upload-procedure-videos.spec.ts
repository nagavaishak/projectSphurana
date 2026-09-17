import path from 'node:path';
import { expect, test } from '@playwright/test';
import { branchUrlPattern } from '../fixtures/branch.fixture.js';
import { SeedHelper } from '../fixtures/index.js';
import { getTestVideo } from '../fixtures/test-assets.fixture.js';

/**
 * Upload Procedure Videos E2E Test
 *
 * Uploads real procedure videos via /upload-assets, waits for AI analysis,
 * asserts the classification the model produced, walks the review funnel, and
 * confirms the assets THIS RUN created land in the API and the content library.
 *
 * Auth: bare-user (storageState) | Timeout: 15 min | Project: authenticated
 */

// Originally 5 — reduced to keep the test inside the local cloudflared tunnel's
// reliability window. 5 videos through MAX_CONCURRENT_UPLOADS=2 (~6-8 min total)
// regularly triggers a 502 mid-flow on the dev tunnel, which reloads the SPA
// and wipes UploadProvider state.
const VIDEO_COUNT = 2;

type VideoAsset = Awaited<ReturnType<SeedHelper['listAssets']>>[number];

/**
 * Resolve a test video, or fail loudly.
 *
 * The asset source (TEST_VIDEO_DIR / public CDN) is environment, not app state
 * — but an unavailable asset is a broken harness, not a legitimate reason to
 * pass. Fail so it gets fixed instead of silently skipping the only test that
 * exercises upload + AI classification.
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

/**
 * List video assets, tolerating the local cloudflared tunnel's occasional 502
 * (which makes `listAssets` throw an opaque SyntaxError from `.json()`).
 * Returning `[]` lets the surrounding `expect.poll` retry instead of blowing up.
 */
async function listVideoAssetsSafe(seed: SeedHelper): Promise<VideoAsset[]> {
  try {
    return await seed.listAssets('video');
  } catch {
    return [];
  }
}

test.describe('Upload Procedure Videos', () => {
  // 20 minutes. Upload wait (≤8 min) and the background-tagging wait (≤8 min)
  // are now sequential rather than one combined gate, and the analysis queue's
  // tail is minutes, not seconds — 15 min could expire mid-wait.
  test.setTimeout(1_200_000);

  // Local cloudflared tunnel hiccups (502) within an 8-min upload+analysis
  // window will reload the SPA and wipe UploadProvider state, leaving the
  // Continue to Review button disabled. Retry once to ride out short blips.
  test.describe.configure({ retries: 1 });

  // @quarantine — genuinely flaky on BOTH lanes: the upload itself intermittently
  // fails, so the spec trips its own guard at line ~125
  // ("an upload failed — the assets never reached S3"). Confirmed across the
  // in-runner/preview lane diff, where it shows as unexpected(1r) vs expected.
  //
  // NOT the same flake as PR #895 ("feat(assets): run AI tagging in the
  // background"), which rewrites this spec to split the upload gate from the
  // tagging gate and raises the timeout to 20m. That addresses the TIMING
  // flake; it leaves the upload-failure assertion untouched. Two distinct
  // failures in one spec.
  //
  // Deliberately not fixed here: #895 is actively rewriting this file, so an
  // edit would conflict with in-flight work. This tag routes the spec to the
  // advisory lane (it is in the `authenticated` project, which the quarantine
  // job DOES run — unlike the connected projects, where the tag disables).
  // Owner: @dcerasi. Re-enable when #895 lands, then re-assess the upload flake
  // separately. Re-enable by 2026-09-04 or delete.
  test(`uploads ${VIDEO_COUNT} procedure videos and verifies AI tagging @quarantine`, async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);

    // Resolve video paths via TEST_VIDEO_DIR env var or CDN download.
    const videoPaths = await Promise.all(
      Array.from({ length: VIDEO_COUNT }, (_, i) =>
        requireTestVideo(`procedure${i + 1}.mp4`)
      )
    );
    // procedure1.mp4 → procedure1
    const expectedStems = videoPaths.map((p) =>
      path.basename(p, path.extname(p)).toLowerCase()
    );

    // The bare org accumulates assets across runs. Snapshot what already exists
    // so every later assertion is scoped to the assets THIS run uploaded.
    const preExistingAssetIds = new Set(
      (await listVideoAssetsSafe(seed)).map((a) => a.id)
    );

    /** Assets created by this run (populated once the uploads land, below). */
    let uploadedAssets: VideoAsset[] = [];

    await test.step('navigate to upload-assets', async () => {
      await seed.gotoProtectedPage('/upload-assets');
      await expect(page.getByText(/drop your files here/i)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step('upload procedure videos via CDP', async () => {
      // React-dropzone + React 19: Playwright's setInputFiles doesn't trigger
      // the onChange handler. Use the UploadProvider's __e2eAddFiles bridge.
      await seed.uploadFilesViaDropzone(videoPaths);

      // Wait for uploads to begin — UI shows "X of Y analyzed" badge
      await expect(page.getByText(/of.*analyzed/i).first()).toBeVisible({
        timeout: 60_000,
      });
    });

    await test.step('wait for uploads to finish', async () => {
      // The "Continue to Review" button is gated on isAllUploadsComplete &&
      // totalCount > 0 (upload-funnel.tsx). Waiting for it to be enabled is
      // the most reliable signal — survives badge re-pluralization and the
      // "in progress" badge being hidden before client state catches up.
      //
      // NOTE: this no longer means the AI has tagged anything. Tagging moved to
      // a background poller, so the funnel deliberately does NOT wait for it.
      // The classification assertion below waits on the server-side analysis
      // status instead — see "wait for AI tagging to land".
      const continueBtn = page.getByRole('button', {
        name: /continue to review/i,
      });
      await expect(continueBtn).toBeEnabled({ timeout: 480_000 });

      // ...but "complete" in that gate means `status === 'complete' || 'error'`,
      // so a FAILED upload also enables Continue. Fail here, at the cause,
      // rather than three steps later on an empty classification list.
      //
      // This is exactly how the S3 CORS misconfiguration hid: the presigned PUT
      // was blocked (net::ERR_FAILED), every asset ended `error`, the funnel let
      // us through, and the test died at "No supplementary assets detected" —
      // pointing at the model instead of at the upload.
      await expect(
        page.getByText(/upload failed/i),
        'an upload failed — the assets never reached S3, so there was nothing for the model to classify'
      ).toHaveCount(0);
    });

    await test.step('identify this run’s assets and wait for AI tagging to land', async () => {
      // Assert the specific files we uploaded exist as NEW assets — a
      // cumulative count would pass on a shared org even if this run uploaded
      // nothing.
      await expect
        .poll(
          async () => {
            const fresh = (await listVideoAssetsSafe(seed)).filter(
              (a) => !preExistingAssetIds.has(a.id)
            );
            return expectedStems.filter((stem) =>
              fresh.some((a) => a.name.toLowerCase().includes(stem))
            );
          },
          {
            timeout: 120_000,
            intervals: [2_000, 5_000],
            message: `expected new video assets for ${expectedStems.join(', ')}`,
          }
        )
        .toEqual(expectedStems);

      uploadedAssets = (await listVideoAssetsSafe(seed)).filter(
        (a) => !preExistingAssetIds.has(a.id)
      );
      expect(uploadedAssets.length).toBeGreaterThanOrEqual(videoPaths.length);

      // Tagging is background and queue-wait dominated, so the review step can
      // render before the model has classified anything — the asset simply
      // isn't in the supplementary list yet. Waiting on the server-side status
      // here is what makes the "Procedure" assertion below deterministic
      // instead of a race against the analysis queue.
      await seed.waitForAssetsAnalyzed(
        uploadedAssets.map((a) => a.id),
        480_000
      );
    });

    // The funnel has three fixed steps (upload-funnel.tsx): upload →
    // review-supplementary → review-talking-head. Every step always renders
    // (each handles its own empty state), so the walk is deterministic — no
    // probing for which step we landed on.
    //
    // A fourth `before-after` step was removed with the before/after format
    // (RETIRED_TEMPLATE_IDS): we cannot confirm two photos show the same client
    // and treatment, so the pairing is no longer collected.
    await test.step('review supplementary assets — assert AI classification', async () => {
      await page.getByRole('button', { name: /continue to review/i }).click();

      await expect(
        page.getByRole('heading', { name: /review supplementary assets/i })
      ).toBeVisible({ timeout: 30_000 });

      // The content-type <Select> on each asset card is defaulted to the
      // model's classification (review-content-step.tsx). A trigger reading
      // "Procedure" is the only proof the AI actually tagged the procedure
      // footage as a procedure — the step's own copy mentions "procedures",
      // so assert on the combobox, not on page text.
      await expect(
        page.getByRole('combobox').filter({ hasText: 'Procedure' }).first()
      ).toBeVisible({ timeout: 30_000 });

      await page.getByRole('button', { name: /^continue$/i }).click();
    });

    // Last step, so the button is the funnel's submit ("Complete").
    await test.step('review talking head step — complete the funnel', async () => {
      await expect(
        page.getByRole('heading', { name: /review talking head/i })
      ).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: /^complete$/i }).click();
    });

    await test.step('verify redirect to the gallery', async () => {
      // The upload funnel finishes on /dashboard/marketing/gallery
      // (upload-funnel.tsx) — the old /dashboard/content home is a redirect.
      await page.waitForURL(branchUrlPattern('marketing/gallery'), {
        timeout: 30_000,
      });
    });

    await test.step('verify assets stored in S3 and thumbnails generated', async () => {
      // Thumbnails are produced by the `video-worker`
      // (asset-thumbnail-processor.ts). If the worker isn't running, these
      // assertions fail — deliberately. A missing thumbnail is a broken
      // pipeline, not a reason to pass.
      for (const asset of uploadedAssets) {
        const detail = await seed.getAsset(asset.id);

        expect(
          detail.blobUrl,
          `asset "${asset.name}" (${asset.id}) should have a blobUrl`
        ).toBeTruthy();
        const blobAccessible = await seed.isUrlAccessible(detail.blobUrl);
        expect(
          blobAccessible,
          `blobUrl for asset "${asset.name}" (${asset.id}) should be accessible`
        ).toBe(true);

        // Polls until the worker writes thumbnailUrl; throws on timeout.
        const thumbnailUrl = await seed.waitForThumbnail(asset.id, 180_000);
        // Thumbnail URLs use the private CDN (CloudFront signed cookies), which
        // the APIRequestContext can't present — assert the shape, not a HEAD.
        expect(
          thumbnailUrl.startsWith('https://'),
          `thumbnailUrl for asset "${asset.name}" should be a valid https URL`
        ).toBe(true);
      }
    });

    await test.step('verify via content library UI', async () => {
      await seed.gotoDashboardPage('/dashboard/marketing/gallery/library');

      for (const stem of expectedStems) {
        await expect(page.getByText(stem).first()).toBeVisible({
          timeout: 30_000,
        });
      }
    });
  });
});
