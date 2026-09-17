import { expect, test } from '@playwright/test';
import { SeedHelper, TEST_ASSETS_BASE_URL } from '../../fixtures/index.js';

/**
 * Image Generation — Monthly Batch (Real, Long-Running)
 *
 * End-to-end happy path for one org's monthly graphic batch against the
 * REAL graphic-generation pipeline — no mocking. Triggers the same
 * `generateMonthlyBatch` service the production cron calls (skipping the
 * 1st-of-month wait via `/testing/trigger-monthly-content-batch`), then
 * polls the resulting `content_batch` until the worker has rendered each
 * graphic item, and verifies the rendered graphics surface with output URLs
 * and that the accept flow still works.
 *
 * ARCHITECTURE NOTE: each graphic is produced by a per-graphic
 * `graphic-generate` worker job that calls the gemini-3-pro-image
 * ("nano-banana") image engine in the worker. There is no single `imageBatchId`
 * to poll — instead we poll the content batch's items until each graphic
 * reaches `ready`/`failed`.
 *
 * ── PRECONDITIONS ARE SEEDED, NOT PROBED ───────────────────────────────────
 * The planner only plans GRAPHIC items for services that have uploaded media
 * (plan-monthly-content → `listServiceIdsWithMedia`; with none, the graphic
 * count is clamped to 0). This spec used to skip when nothing was seeded — the
 * run went green having rendered nothing. It now seeds a service with a linked
 * image asset and asserts the batch plans at least one graphic.
 *
 * COST NOTE: every graphic is a real, billed Gemini image generation, so this
 * test renders exactly ONE graphic (graphicCount: 1) — enough to prove the
 * end-to-end path. It requires a billing-enabled GOOGLE_GENAI_API_KEY on the
 * worker; a free-tier key 429s and every render fails.
 *
 * Lives under `src/real/` so it's opt-in: the per-PR `authenticated`
 * project excludes this directory. Trigger manually or on a schedule:
 *
 *   pnpm --filter @borradh-workspace/app-e2e exec playwright test \
 *     --project=real-e2e
 *
 * Prerequisites:
 *   - The video-worker running to process `graphic-generate` jobs, with a
 *     billing-enabled GOOGLE_GENAI_API_KEY.
 *   - Bare-user storageState (signed-in, post-onboarding org).
 */

const TEST_IMAGE_URL = `${TEST_ASSETS_BASE_URL}/test-image.jpg`;

/** Every row this spec creates is named with this prefix so afterEach reaps it. */
const SEED_PREFIX = 'E2E Image Batch';

test.describe('Image generation monthly batch (real, long-running)', () => {
  // Worker render + polling buffer. A single nano-banana render is fast, but
  // worker queue contention / cold start can stretch this — cap at 8 min.
  test.setTimeout(8 * 60 * 1000);

  /** Content batches created during the current test, removed in afterEach. */
  const createdBatchIds: string[] = [];

  test.afterEach(async ({ page, request }) => {
    const seed = new SeedHelper(page, request);

    // Batch first: removes content_batch_item + graphic rows that reference
    // the seeded service/asset below.
    for (const id of createdBatchIds.splice(0)) {
      await seed.cleanupContentBatch(id);
    }

    const assets = await seed.listAssets('image');
    for (const asset of assets.filter((a) => a.name.startsWith(SEED_PREFIX))) {
      await seed.authenticatedApiCall(
        'DELETE',
        `/assets/${asset.id}`,
        undefined,
        [404]
      );
    }

    const services = await seed.listServices();
    for (const service of services.filter((s) =>
      s.name.startsWith(SEED_PREFIX)
    )) {
      await seed.deleteServiceWithLinkedAssets(service.id);
    }
  });

  test('seeds and renders monthly graphics end-to-end', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);

    // ─── 1. Resolve the bare-user's org ─────────────────────────────
    const organizationId = await seed.getActiveOrganizationId();
    expect(
      organizationId,
      'No active organization on bare-user session — re-run setup-bare.'
    ).toBeTruthy();
    console.log(`[image-generation] organizationId=${organizationId}`);

    // ─── 2. Seed the planner's precondition: a media-backed service ──
    // Graphics are composed from a service's uploaded media; with no
    // media-backed service the planner plans zero graphics.
    await seedGraphicEligibleService(
      seed,
      `${SEED_PREFIX} Service ${Date.now()}`
    );

    // A deterministic future month keeps this test's batch isolated from
    // whatever the bare-user's current monthly batch looks like, and the
    // afterEach cleanup removes it so re-runs start fresh.
    const periodMonth = futureSentinelMonth();
    console.log(`[image-generation] periodMonth=${periodMonth}`);

    // ─── 3. Trigger the monthly batch directly ──────────────────────
    const contentBatchId =
      await test.step('trigger monthly content batch', async () => {
        const result = await seed.triggerMonthlyContentBatch({
          organizationId: organizationId as string,
          periodMonth,
          // Videos exercise a separate pipeline (create-video-dialog.spec).
          // Isolate the graphic path here so latency isn't dominated by
          // Remotion/video rendering.
          videoCount: 0,
          // Render a single graphic: each one is a real gemini-3-pro-image
          // ("nano-banana") generation that costs money + burns API quota, and
          // the assertions below only need one graphic to reach `ready`. One is
          // enough to prove the end-to-end render path works.
          graphicCount: 1,
        });

        // Record immediately so a failing assertion still reaps the batch.
        createdBatchIds.push(result.batchId);
        console.log(
          `[image-generation] content_batch=${result.batchId} graphicsSeeded=${result.graphicsSeeded} jobsEnqueued=${result.jobsEnqueued} failures=${result.failures.length}`
        );
        for (const failure of result.failures) {
          console.warn(`[image-generation] seed failure: ${failure}`);
        }

        expect(result.alreadyExisted).toBe(false);
        expect(
          result.graphicsSeeded,
          `expected at least one graphic to be planned for the media-backed service; failures: ${JSON.stringify(result.failures)}`
        ).toBeGreaterThan(0);
        expect(
          result.jobsEnqueued,
          'expected graphic-generate jobs to be enqueued'
        ).toBeGreaterThan(0);

        return result.batchId;
      });

    // ─── 4. Wait for the worker to render the graphics ──────────────
    await test.step('wait for content batch graphics to render', async () => {
      const detail = await seed.waitForContentBatchGraphics(contentBatchId, {
        timeoutMs: 6 * 60 * 1000,
        pollIntervalMs: 5_000,
      });

      const graphicItems = detail.items.filter((i) => i.kind === 'graphic');
      expect(graphicItems.length).toBeGreaterThan(0);

      const readyItems = graphicItems.filter(
        (i) => i.graphic?.status === 'ready'
      );
      expect(
        readyItems.length,
        'expected at least one graphic to render successfully'
      ).toBeGreaterThan(0);
    });

    // ─── 5. Verify rendered graphics + the socials page loads ───────
    await test.step('verify rendered graphics have reachable outputs', async () => {
      // The socials page reads `getCurrentBatch` scoped to the current UTC
      // month; our future periodMonth keeps the test batch out of that view,
      // so this is a shallow "page renders cleanly post-render" check, and
      // the real assertion reads the batch via the same API the dialog uses.
      await seed.gotoDashboardPage('/dashboard/marketing/socials');
      await expect(page.getByRole('tab', { name: 'List' })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByRole('button', { name: 'Generate content' })
      ).toBeVisible({ timeout: 15_000 });

      // GET /content-batches/:id returns { batch, items } — the batch row
      // (id/status/…) is nested under `batch`; `items` is top-level.
      const batchDetail = (await seed.authenticatedApiCall(
        'GET',
        `/content-batches/${contentBatchId}`
      )) as {
        batch: { id: string };
        items: Array<{
          kind: 'video' | 'graphic';
          graphic: { status: string; outputs: unknown } | null;
        }>;
      };

      expect(batchDetail.batch.id).toBe(contentBatchId);

      const graphicsWithOutputs = batchDetail.items.filter(
        (item) => outputUrls(item.graphic).length > 0
      );
      expect(
        graphicsWithOutputs.length,
        'expected at least one rendered graphic with output URLs'
      ).toBeGreaterThan(0);

      // Spot-check one URL is reachable — guards against a malformed S3/CDN
      // path written by the render/post-process step.
      const firstUrl = outputUrls(graphicsWithOutputs[0]?.graphic)[0];
      expect(firstUrl, 'expected a rendered graphic output URL').toBeTruthy();
      expect(
        await seed.isUrlAccessible(firstUrl),
        `expected rendered graphic URL to be reachable: ${firstUrl}`
      ).toBe(true);
    });

    // NOTE: there is no longer a standalone graphic editor to open. The
    // Fabric scene editor (`/dashboard/graphics/:id/edit`, "Add text" /
    // "Properties" panel) was removed in the migration to gemini-3-pro-image
    // generation — graphics are now generated raster images surfaced through
    // the socials review/preview flow, not editable Fabric scenes. The old
    // "open a rendered graphic in the editor" step has been dropped rather
    // than repointed, because the feature it covered no longer exists.

    // ─── 6. Accept one item to verify the accept flow still works ───
    await test.step('accept one ready graphic item via the API', async () => {
      const batchDetail = (await seed.authenticatedApiCall(
        'GET',
        `/content-batches/${contentBatchId}`
      )) as {
        items: Array<{
          id: string;
          kind: 'video' | 'graphic';
          reviewStatus: string;
          graphic: { status: string } | null;
        }>;
      };

      const pickable = batchDetail.items.find(
        (i) =>
          i.kind === 'graphic' &&
          i.reviewStatus === 'pending' &&
          i.graphic?.status === 'ready'
      );
      expect(
        pickable,
        'expected at least one pending+ready graphic to accept'
      ).toBeTruthy();

      // The accept endpoint takes no body — it schedules using the item's
      // planned slot. Just assert it doesn't return a structured error.
      const acceptResult = (await seed.authenticatedApiCall(
        'POST',
        `/content-batches/items/${pickable?.id}/accept`
      )) as { error?: { code?: string } };

      expect(
        acceptResult.error?.code,
        `accept returned error: ${JSON.stringify(acceptResult)}`
      ).toBeFalsy();
    });
  });
});

/** Non-empty output URLs on a batch item's graphic (empty for videos/nulls). */
function outputUrls(
  graphic: { outputs?: unknown } | null | undefined
): string[] {
  const outputs = Array.isArray(graphic?.outputs)
    ? (graphic.outputs as Array<{ url?: string }>)
    : [];
  return outputs
    .map((o) => o.url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
}

/**
 * Seed the precondition the graphic planner needs: a service whose media a
 * graphic can be composed from (`listServiceIdsWithMedia` — an `image` asset
 * linked via asset_service). Asserts the API reports the service as
 * graphic-eligible, so a broken link fails here rather than as a mysterious
 * "0 graphics planned" later.
 */
async function seedGraphicEligibleService(
  seed: SeedHelper,
  serviceName: string
): Promise<{ id: string }> {
  // The worker fetches this URL to compose the graphic; a dead fixture would
  // surface as an opaque render failure minutes later.
  expect(
    await seed.isUrlAccessible(TEST_IMAGE_URL),
    `E2E image fixture must be reachable: ${TEST_IMAGE_URL}`
  ).toBe(true);

  // Seed from a CLONE, never the shared fixture itself. The afterEach below
  // deletes this asset, and `DELETE /assets/:id` hard-deletes the S3 object
  // behind its blobUrl — pointing it at the shared fixture is how the fixture
  // kept vanishing and breaking every other suite. See SeedHelper.cloneFixtureUrl.
  const blobUrl = await seed.cloneFixtureUrl(TEST_IMAGE_URL);

  const service = await seed.createService({
    name: serviceName,
    category: 'treatment',
  });

  const asset = (await seed.authenticatedApiCall('POST', '/assets', {
    name: `${SEED_PREFIX} Photo ${Date.now()}`,
    blobUrl,
    type: 'image',
    // 'edited' skips the AI analysis pass — we only need the row + the link.
    source: 'edited',
    tags: ['procedure'],
  })) as { id?: string };
  expect(
    asset.id,
    `seeding an image asset returned no row: ${JSON.stringify(asset)}`
  ).toBeTruthy();

  await seed.authenticatedApiCall('POST', `/assets/${asset.id}/services`, {
    serviceIds: [service.id],
  });

  const listed = (await seed.authenticatedApiCall(
    'GET',
    '/organization-services'
  )) as { items?: Array<{ id: string; hasGraphicMedia?: boolean }> };
  const row = (listed.items ?? []).find((s) => s.id === service.id);
  expect(
    row?.hasGraphicMedia,
    `seeded service "${serviceName}" must be graphic-eligible (asset link landed)`
  ).toBe(true);

  return service;
}

/**
 * Pick a deterministic future month so this test's batch never collides
 * with the org's real current-month batch. `2099-MM` keeps the row outside
 * any production cron window and is obvious as test data in DB dumps.
 */
function futureSentinelMonth(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `2099-${month}`;
}
