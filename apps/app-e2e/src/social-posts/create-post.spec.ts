import { type Locator, type Page, expect, test } from '@playwright/test';
import { SeedHelper } from '../fixtures/index.js';

/**
 * New-post wizard smoke (apps/app).
 *
 * Route: /dashboard/marketing/socials (the Planner). Its header action
 * ("Generate content", `NewPostButton`) opens a single multi-step
 * NewPostDialog (no hand-off sub-dialogs):
 *
 *   step 1: pick Video (+ a template from a filterable grid) or Graphic
 *   step 2: pick the service
 *   …Video then continues to voiceover (some templates) + footage.
 *
 * Real API, bare-org auth via the `authenticated` project. This smoke only
 * drives the wizard's early steps — it never clicks the final "Generate", so
 * no render is triggered (those are covered by the long-running specs under
 * src/real/).
 *
 * The entry point is NOT gated: `NewPostButton` renders unconditionally in the
 * planner header. (It previously sat behind a `socials-create-actions` PostHog
 * flag and was labelled "Create Post"; the old self-skip guard for that flag
 * silently skipped every test in this file once the button was renamed.)
 */

const PLANNER = '/dashboard/marketing/socials';

/** Open the new-post wizard from the planner header. Returns the dialog. */
async function openCreatePost(page: Page): Promise<Locator> {
  const button = page.getByRole('button', { name: 'Generate content' });
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();

  const dialog = page.locator('[role="dialog"]');
  await dialog
    .getByText('Create a new post', { exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });
  return dialog;
}

test.describe('Socials — Create Post wizard', () => {
  test('step 1 offers Video and Graphic types', async ({ page, request }) => {
    const seed = new SeedHelper(page, request);
    await seed.gotoDashboardPage(PLANNER);

    const dialog = await openCreatePost(page);
    await expect(
      dialog.getByText('Create a new post', { exact: true })
    ).toBeVisible();

    // Both type cards are present (matched by their unique descriptions).
    await expect(
      dialog.getByText('Organic or paid video templates.')
    ).toBeVisible();
    await expect(
      dialog.getByText(/a designed post — single image or carousel/i)
    ).toBeVisible();
  });

  test('Video shows the template grid with usage filters and Back works', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    await seed.gotoDashboardPage(PLANNER);

    const dialog = await openCreatePost(page);

    // Choose "Video" — the template grid appears in the same step.
    await dialog.locator('label[for="post-type-video"]').click();

    // A known paid template and the usage filters render.
    //
    // NOT 'Before and After' — that format was retired (RETIRED_TEMPLATE_IDS),
    // so the grid renders `getSelectableTemplates()` without it and this
    // assertion failed on every run. 'Authority' is an ad-usage template that
    // is still selectable.
    await expect(dialog.getByText('Authority', { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Paid', exact: true })
    ).toBeVisible();

    // Filtering to organic surfaces an organic-only template.
    await dialog.getByRole('button', { name: 'Organic', exact: true }).click();
    await expect(dialog.getByText('Caption Tease')).toBeVisible();

    // Selecting a template + Continue advances to the service step…
    await dialog.getByText('Caption Tease', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(
      dialog.getByText('Which service is this for?', { exact: true })
    ).toBeVisible();

    // …and Back returns to step 1.
    await dialog.getByRole('button', { name: 'Back' }).click();
    await expect(
      dialog.getByText('Create a new post', { exact: true })
    ).toBeVisible();
  });

  test('Graphic advances to a service-only step', async ({ page, request }) => {
    const seed = new SeedHelper(page, request);
    await seed.gotoDashboardPage(PLANNER);

    const dialog = await openCreatePost(page);

    // Choose "Graphic" — no template grid; Continue goes straight to service.
    await dialog.locator('label[for="post-type-graphic"]').click();
    await dialog.getByRole('button', { name: 'Continue' }).click();

    await expect(
      dialog.getByText('Which service is this for?', { exact: true })
    ).toBeVisible({ timeout: 10_000 });
    // Service combobox + the "we pick the template/format" hint.
    await expect(dialog.locator('button[role="combobox"]')).toBeVisible();
    await expect(
      dialog.getByText(/pick a template and format for you/i)
    ).toBeVisible();
    // Generate stays disabled until a service is picked.
    await expect(
      dialog.getByRole('button', { name: /generate graphic/i })
    ).toBeDisabled();
  });
});
