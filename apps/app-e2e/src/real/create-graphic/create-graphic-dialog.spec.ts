import { type Page, expect, test } from '@playwright/test';
import { SeedHelper, TEST_ASSETS_BASE_URL } from '../../fixtures/index.js';

/**
 * Create-graphic via the Socials "Generate content" dialog (real, long-running).
 *
 * Graphic creation lives in the multi-step "Create a new post" dialog launched
 * from /dashboard/marketing/socials:
 *
 *   Generate content → step 1: pick "Graphic" → step 2: format + service →
 *   Generate graphic
 *
 * No template is chosen — the backend picks a matching editorial template for
 * the service's uploaded media, POSTs /graphics/generate (placeholder row +
 * `graphic-generate` job), and the GraphicProcessingModal polls
 * GET /graphics/:id until it flips to `ready` / `failed`. We drive that happy
 * path against the real API + render worker and poll until the graphic reaches
 * `ready`.
 *
 * ── PRECONDITIONS ARE SEEDED, NOT PROBED ───────────────────────────────────
 * With AI images OFF (the default) the service picker only lists services that
 * have uploaded media (`hasGraphicMedia`, derived from the asset_service join).
 * This spec used to self-skip when the org happened to have none — i.e. the run
 * went green having generated nothing. It now SEEDS the precondition: a service
 * plus a linked image asset, asserted graphic-eligible before the UI is
 * touched. If the dialog can't reach a graphic from there, that's a real
 * failure and the test says so.
 *
 * ── COST ────────────────────────────────────────────────────────────────────
 * Every generate is a real, billed render. We pick the "Single image" format
 * (not the default carousel) so each generate produces exactly one image, and
 * the review modal's regenerate action is the unambiguous "Regenerate" button.
 * Test 1 = 1 render. Test 2 = 2 renders (initial + one re-roll).
 */

const TEST_IMAGE_URL = `${TEST_ASSETS_BASE_URL}/test-image.jpg`;

/** Every row this spec creates is named with this prefix so afterEach reaps it. */
const SEED_PREFIX = 'E2E Graphic Dialog';

test.describe('Create graphic — Socials Create Post dialog (real)', () => {
  // Render is seconds-to-minutes; allow for worker queue contention.
  test.setTimeout(10 * 60 * 1000);

  /** Graphics created during the current test, deleted in afterEach. */
  const createdGraphicIds: string[] = [];

  test.afterEach(async ({ page, request }) => {
    const seed = new SeedHelper(page, request);

    // Graphics first — they reference the service/asset rows below.
    for (const id of createdGraphicIds.splice(0)) {
      await seed.authenticatedApiCall(
        'DELETE',
        `/graphics/${id}`,
        undefined,
        [404]
      );
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

  test('generates a graphic through the dialog and renders it', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    const serviceName = `${SEED_PREFIX} Service ${Date.now()}`;

    await seedGraphicEligibleService(seed, serviceName);

    const graphicId = await generateGraphicViaDialog(
      page,
      seed,
      serviceName,
      createdGraphicIds
    );

    await test.step('wait for the render to complete', async () => {
      // The processing modal is open while the worker renders.
      await expect(page.getByText(/generating your graphic/i)).toBeVisible({
        timeout: 10_000,
      });

      // Poll the API for the authoritative status (the modal polls the same
      // endpoint, so the UI follows shortly after).
      const ready = await waitForGraphicReady(seed, graphicId, 8 * 60 * 1000);
      expect(ready.status).toBe('ready');

      // At least one rendered output with a reachable URL.
      const url = ready.outputs.find((o) => !!o.url)?.url;
      expect(url, 'expected a rendered graphic output URL').toBeTruthy();
      expect(
        await seed.isUrlAccessible(url as string),
        `expected rendered graphic URL to be reachable: ${url}`
      ).toBe(true);

      // The modal flips to the ready state once its next poll lands. The ready
      // state offers Accept ("Looks good") + "Request changes".
      await expect(
        page.getByRole('button', { name: 'Looks good' })
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole('button', { name: /request changes/i })
      ).toBeVisible();
    });
  });

  test('regenerates the graphic from the review modal with a change request', async ({
    page,
    request,
  }) => {
    // Two real renders (initial + regenerate) — give it extra headroom.
    test.setTimeout(16 * 60 * 1000);
    const seed = new SeedHelper(page, request);
    const serviceName = `${SEED_PREFIX} Regen Service ${Date.now()}`;

    await seedGraphicEligibleService(seed, serviceName);

    const firstId = await generateGraphicViaDialog(
      page,
      seed,
      serviceName,
      createdGraphicIds
    );

    const firstReady = await waitForGraphicReady(seed, firstId, 8 * 60 * 1000);
    expect(firstReady.status).toBe('ready');

    // The review modal exposes "Request changes" in the ready state.
    const requestChanges = page.getByRole('button', {
      name: /request changes/i,
    });
    await expect(requestChanges).toBeVisible({ timeout: 20_000 });

    // Capture the regenerate POST — it hits /graphics/:id/regenerate carrying
    // the user's change request (the template is pinned server-side).
    const regenResponse = page.waitForResponse(
      (r) =>
        /\/graphics\/[^/]+\/regenerate\/?$/.test(new URL(r.url()).pathname) &&
        r.request().method() === 'POST' &&
        r.status() < 400,
      { timeout: 60_000 }
    );

    await requestChanges.click();
    await page
      .locator('#graphic-change')
      .fill('Use brighter colours and make the headline bigger.');

    // Single-image graphics expose exactly one re-roll action, "Regenerate"
    // (a carousel would also offer a per-slide variant — we deliberately don't
    // create one, so there is nothing to branch on).
    await page.getByRole('button', { name: /^regenerate$/i }).click();

    const regenBody = (await (await regenResponse).json()) as { id?: string };
    const secondId = regenBody.id;
    expect(secondId, 'regenerate returned a new graphic id').toBeTruthy();
    expect(secondId).not.toBe(firstId);
    createdGraphicIds.push(secondId as string);

    // The modal repoints at the new graphic and shows it rendering, then ready.
    await expect(page.getByText(/generating your graphic/i)).toBeVisible({
      timeout: 15_000,
    });
    const secondReady = await waitForGraphicReady(
      seed,
      secondId as string,
      8 * 60 * 1000
    );
    expect(secondReady.status).toBe('ready');

    await expect(page.getByRole('button', { name: 'Looks good' })).toBeVisible({
      timeout: 20_000,
    });
  });
});

/**
 * Seed the precondition the graphic path needs: a service whose media the
 * generator can compose from.
 *
 * `hasGraphicMedia` (list-services → listServiceIdsWithMedia) is true when the
 * service has a linked `image` asset (or a video with a thumbnail). We create
 * an image asset pointing at the public E2E fixture and link it, then assert
 * the API now reports the service as graphic-eligible — if it doesn't, the
 * dialog would silently list nothing and any downstream failure would be
 * mystifying.
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
 * Drive the Socials "Generate content" dialog through the graphic path and
 * submit. Returns the created graphic id and records it for cleanup.
 *
 * No skip guards: the "Generate content" button is part of the planner header
 * for every org, so its absence is a regression, not an environment.
 */
async function generateGraphicViaDialog(
  page: Page,
  seed: SeedHelper,
  serviceName: string,
  createdGraphicIds: string[]
): Promise<string> {
  await seed.gotoDashboardPage('/dashboard/marketing/socials');

  const createPost = page.getByRole('button', { name: 'Generate content' });
  await expect(createPost).toBeVisible({ timeout: 20_000 });
  await createPost.click();

  const dialog = page.locator('[role="dialog"]');
  await expect(
    dialog.getByText('Create a new post', { exact: true })
  ).toBeVisible({ timeout: 10_000 });

  await dialog.locator('label[for="post-type-graphic"]').click();
  await dialog.getByRole('button', { name: 'Continue' }).click();

  await expect(
    dialog.getByText('Which service is this for?', { exact: true })
  ).toBeVisible({ timeout: 10_000 });

  // Organic (the default) + Single image: one render, one unambiguous
  // "Regenerate" action in the review modal. AI images stay OFF, so the graphic
  // is composed from the media we seeded onto this service.
  await dialog.locator('label[for="graphic-single"]').click();

  await dialog.getByRole('combobox').first().click();
  await page.getByPlaceholder('Search…').fill(serviceName);
  await page.getByRole('option', { name: serviceName }).click();

  const generate = dialog.getByRole('button', { name: /generate graphic/i });
  await expect(generate).toBeEnabled({ timeout: 15_000 });

  const createResponse = page.waitForResponse(
    (r) =>
      /\/graphics\/generate\/?$/.test(new URL(r.url()).pathname) &&
      r.request().method() === 'POST' &&
      r.status() < 400,
    { timeout: 90_000 }
  );

  await generate.click();

  const body = (await (await createResponse).json()) as { id?: string };
  expect(body.id, 'POST /graphics/generate returned a graphic id').toBeTruthy();
  // Record immediately so a failure further down the test still reaps the row.
  createdGraphicIds.push(body.id as string);
  return body.id as string;
}

/** GET /graphics/:id — the fields this spec cares about. */
async function getGraphic(
  seed: SeedHelper,
  graphicId: string
): Promise<{ status: string; outputs: Array<{ url?: string }> }> {
  const g = (await seed.authenticatedApiCall(
    'GET',
    `/graphics/${graphicId}`
  )) as { status?: string; outputs?: Array<{ url?: string }> };
  return { status: g.status ?? 'unknown', outputs: g.outputs ?? [] };
}

/**
 * Poll GET /graphics/:id until the row reaches a terminal state, then assert it
 * rendered. `failed` fails immediately with the status rather than burning the
 * remaining budget waiting for a `ready` that will never come.
 */
async function waitForGraphicReady(
  seed: SeedHelper,
  graphicId: string,
  timeoutMs: number
): Promise<{ status: string; outputs: Array<{ url?: string }> }> {
  await expect
    .poll(async () => (await getGraphic(seed, graphicId)).status, {
      timeout: timeoutMs,
      intervals: [5000],
      message: `graphic ${graphicId} never reached a terminal state`,
    })
    .toMatch(/^(ready|failed)$/);

  const graphic = await getGraphic(seed, graphicId);
  expect(graphic.status, `graphic rendering failed for ${graphicId}`).toBe(
    'ready'
  );
  return graphic;
}
