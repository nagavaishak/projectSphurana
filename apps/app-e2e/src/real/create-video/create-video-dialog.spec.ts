import { expect, test } from '@playwright/test';
import { SeedHelper } from '../../fixtures/index.js';

/**
 * Create-video via the Socials "Generate content" dialog (real, long-running).
 *
 * Every step lives in the one "Create a new post" wizard, launched from
 * /dashboard/marketing/socials:
 *
 *   Generate content
 *     → step 1: pick "Video" + a template
 *     → step 2: pick the service (+ offer for the Offer template)
 *     → [voiceover step — Authority / Educational only]
 *     → step 3: pick footage (one tab per slot), then Generate
 *
 * We drive the cheapest complete path: the organic "Caption Tease" template,
 * which skips the voiceover step. It still requires footage, so we seed a
 * tagged video asset first — the footage step auto-selects it. On Generate the
 * dialog AI-writes the on-screen copy, POSTs /videos and queues an export; we
 * poll the real render worker until the video reaches `ready`.
 *
 * ── PRECONDITIONS ARE SEEDED, NOT PROBED ───────────────────────────────────
 * The service is created up front (and reaped afterwards) rather than
 * conditionally reused, so the run is identical on a bare org and a busy one.
 * The "Generate content" button is part of the planner header for every org —
 * this spec used to self-skip when it couldn't find a (since-renamed) "Create
 * Post" button, which meant it never actually ran. Its absence is now a failure.
 *
 * Auth: bare-org storageState (the `real-e2e` project, single worker).
 * Cost: exactly one real render per run.
 */

/** Every row this spec creates is named with this prefix so afterEach reaps it. */
const SEED_PREFIX = 'E2E Video Dialog';

test.describe('Create video — Socials Create Post dialog (real)', () => {
  // generateOrganicCopy (AI) + a full render. Give it a generous ceiling.
  test.setTimeout(10 * 60 * 1000);

  /** Videos created during the current test, deleted in afterEach. */
  const createdVideoIds: string[] = [];

  test.afterEach(async ({ page, request }) => {
    const seed = new SeedHelper(page, request);

    for (const id of createdVideoIds.splice(0)) {
      await seed.authenticatedApiCall(
        'DELETE',
        `/videos/${id}`,
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

  test('generates an organic video through the dialog and renders it', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    const serviceName = `${SEED_PREFIX} Service ${Date.now()}`;

    // The organic template needs a service to anchor the AI copy.
    await seed.createService({ name: serviceName, category: 'treatment' });

    // Footage is mandatory in the wizard — guarantee at least one tagged video
    // asset so the footage step has something to auto-select. Idempotent, and
    // org-wide (the slot grid merges tag-matched assets with the service's own).
    await seed.ensureTaggedVideoAsset();

    await seed.gotoDashboardPage('/dashboard/marketing/socials');

    const createPost = page.getByRole('button', { name: 'Generate content' });
    await expect(createPost).toBeVisible({ timeout: 20_000 });

    const dialog = page.locator('[role="dialog"]');

    await test.step('step 1 — pick Video + the Caption Tease template', async () => {
      await createPost.click();
      await expect(
        dialog.getByText('Create a new post', { exact: true })
      ).toBeVisible({ timeout: 10_000 });

      // Choose the "Video" type card (a radio inside its label).
      await dialog.locator('label[for="post-type-video"]').click();

      // The template grid appears in the same step; pick the organic
      // Caption Tease card, then advance.
      await dialog.getByText('Caption Tease', { exact: true }).click();
      await dialog.getByRole('button', { name: 'Continue' }).click();
    });

    await test.step('step 2 — pick the seeded service', async () => {
      await expect(
        dialog.getByText('Which service is this for?', { exact: true })
      ).toBeVisible({ timeout: 10_000 });

      // The first combobox on this step is the service picker (an optional
      // offer picker may follow it for non-offer templates).
      await dialog.getByRole('combobox').first().click();
      await page.getByPlaceholder('Search…').fill(serviceName);
      await page.getByRole('option', { name: serviceName }).click();

      await dialog.getByRole('button', { name: 'Continue' }).click();
    });

    const videoId =
      await test.step('step 3 — footage auto-selects, then Generate', async () => {
        await expect(
          dialog.getByText('Choose your footage', { exact: true })
        ).toBeVisible({ timeout: 10_000 });

        // The seeded asset auto-selects, enabling Generate (the last step).
        const generate = dialog.getByRole('button', { name: /^Generate$/ });
        await expect(generate).toBeEnabled({ timeout: 15_000 });

        // Capture the created video id from POST /videos so we can poll its
        // render status (and delete it afterwards).
        const createResponse = page.waitForResponse(
          (r) =>
            /\/videos\/?$/.test(new URL(r.url()).pathname) &&
            r.request().method() === 'POST' &&
            r.status() < 400,
          { timeout: 90_000 }
        );

        await generate.click();

        const body = (await (await createResponse).json()) as { id?: string };
        expect(body.id, 'POST /videos returned a video id').toBeTruthy();
        // Record immediately so a failure further down still reaps the row.
        createdVideoIds.push(body.id as string);
        return body.id as string;
      });

    await test.step('wait for the render to complete', async () => {
      const { blobUrl } = await seed.waitForVideoReady(videoId, 8 * 60 * 1000);
      expect(blobUrl).toBeTruthy();
    });
  });
});
