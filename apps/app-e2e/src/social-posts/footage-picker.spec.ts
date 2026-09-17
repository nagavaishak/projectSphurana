import { type Locator, type Page, expect, test } from '@playwright/test';
import { SeedHelper } from '../fixtures/index.js';

/**
 * "Choose your footage" step of the Socials new-post wizard (apps/app).
 *
 * Route: /dashboard/socials → Generate content → Video → Caption Tease →
 * service. Caption Tease is the cheapest path to the footage step: organic (so
 * the voiceover step is skipped) with exactly one slot, tagged `procedure`.
 *
 * Real API, bare-org auth via the `authenticated` project. The wizard is
 * driven to the footage step only — never to Generate — so no render is
 * queued (that path is covered by src/real/create-video).
 *
 * The picker lists raw uploads only (buildUploadedVideoLibrary filters
 * `source === 'raw'`), so it needs SeedHelper.ensureRawFootageAsset — the
 * source='edited' seed behind ensureTaggedVideoAsset is invisible here.
 *
 * No conditional skip: routes/_authed/dashboard/socials/index.tsx renders
 * <NewPostButton /> ("Generate content") unconditionally on desktop, and
 * socials-mobile-page.tsx renders the same component on mobile. Nothing gates
 * it, so a missing button is a regression and must fail loudly rather than
 * skip. (Sibling specs still guard on a `socials-create-actions` PostHog flag
 * that exists nowhere in the app source — see this spec's report.)
 */

// Serial: both tests share one idempotent org-level fixture. Run in parallel,
// two workers could each observe an empty service list and create a duplicate,
// making the service name ambiguous in the wizard's combobox.
test.describe.configure({ mode: 'serial' });

/**
 * Ensure the org has a service and one raw `procedure` clip linked to it.
 * Idempotent — reuses whatever the org already has.
 */
async function seedFootage(
  seed: SeedHelper
): Promise<{ serviceName: string; clipName: string }> {
  const services = await seed.listServices();
  const service =
    services[0] ??
    (await seed.createService({
      name: 'E2E Footage Service',
      category: 'treatment',
    }));

  const { name } = await seed.ensureRawFootageAsset({
    serviceId: service.id,
    tags: ['procedure'],
  });

  return { serviceName: service.name, clipName: name };
}

/**
 * Drive the wizard from /dashboard/socials to the footage step.
 * Returns the dialog.
 */
async function openFootageStep(
  page: Page,
  serviceName: string
): Promise<Locator> {
  await page.getByRole('button', { name: 'Generate content' }).click();

  const dialog = page.locator('[role="dialog"]');
  await dialog
    .getByText('Create a new post', { exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });

  await dialog.locator('label[for="post-type-video"]').click();
  await dialog.getByText('Caption Tease', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();

  await expect(
    dialog.getByText('Which service is this for?', { exact: true })
  ).toBeVisible({ timeout: 10_000 });
  await selectService(page, dialog, serviceName);
  await dialog.getByRole('button', { name: 'Continue' }).click();

  await expect(
    dialog.getByText('Choose your footage', { exact: true })
  ).toBeVisible({ timeout: 10_000 });
  return dialog;
}

/**
 * Pick a service from the step's cmdk combobox (SearchCombobox).
 *
 * Typing into the CommandInput first is what makes this reliable: it narrows
 * the list to the one row, so the click can't race cmdk re-ordering rows under
 * the cursor. The trigger assertion then confirms onSelect actually landed,
 * rather than trusting the click.
 */
async function selectService(
  page: Page,
  dialog: Locator,
  serviceName: string
): Promise<void> {
  const trigger = dialog.getByRole('combobox').first();
  await trigger.click();

  const search = page.getByPlaceholder('Search…');
  await search.waitFor({ state: 'visible', timeout: 10_000 });
  await search.fill(serviceName);

  const option = page.getByRole('option', { name: serviceName, exact: true });
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();

  await expect(trigger).toContainText(serviceName, { timeout: 10_000 });
}

const typeFilterOf = (dialog: Locator): Locator =>
  dialog.getByRole('combobox', { name: 'Filter clips by type' });

const selectedCounterOf = (dialog: Locator): Locator =>
  dialog.getByText(/\d+ of \d+ selected/);

test.describe('Socials — Create Post footage picker', () => {
  // Seeding runs several real API calls before the wizard is driven.
  test.setTimeout(120_000);

  test('lists the seeded raw clip, badges its service match, and defaults the type filter to the slot tag', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    const { serviceName, clipName } = await seedFootage(seed);
    await seed.gotoDashboardPage('/dashboard/marketing/socials');

    const dialog = await openFootageStep(page, serviceName);

    // The seeded raw clip renders as a tile carrying its name…
    const clip = dialog.getByRole('button', { name: clipName });
    await expect(clip).toBeVisible({ timeout: 15_000 });

    // …and, being linked to the promoted service, a "Service match" badge.
    await expect(clip.getByText('Service match')).toBeVisible();

    // Caption Tease's only slot is tagged `procedure`, so the type filter
    // opens pre-set to it rather than to "All types".
    await expect(typeFilterOf(dialog)).toContainText('Procedure');
  });

  test('a tag matching no clip stays escapable and preserves the selection', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    const { serviceName, clipName } = await seedFootage(seed);
    await seed.gotoDashboardPage('/dashboard/marketing/socials');

    const dialog = await openFootageStep(page, serviceName);
    const typeFilter = typeFilterOf(dialog);
    const counter = selectedCounterOf(dialog);
    const clip = dialog.getByRole('button', { name: clipName });

    await expect(clip).toBeVisible({ timeout: 15_000 });
    // The slot auto-selects its recommended picks from the `procedure`-tagged
    // clips, so something is selected before any filtering happens.
    await expect(counter).toHaveText(/[1-9]\d* of \d+ selected/);
    const selectedBeforeFilter = await counter.textContent();

    await test.step('switching to a tag with no clips leaves an escape route', async () => {
      await typeFilter.click();
      await page
        .getByRole('option', { name: 'Testimonial', exact: true })
        .click();

      await expect(clip).toBeHidden();
      await expect(
        dialog.getByText('No uploaded clips match these filters.')
      ).toBeVisible();

      // The regression guard: an empty grid must not strand the user. The
      // filter that emptied it stays on screen, and the copy points at the way
      // out.
      await expect(typeFilter).toBeVisible();
      await expect(typeFilter).toContainText('Testimonial');
      await expect(dialog.getByText(/switch to All types/i)).toBeVisible();
    });

    await test.step('filtering does not drop the selection', async () => {
      await expect(counter).toHaveText(selectedBeforeFilter ?? '');
    });

    await test.step('switching back to All types restores the clip', async () => {
      await typeFilter.click();
      await page
        .getByRole('option', { name: 'All types', exact: true })
        .click();

      await expect(clip).toBeVisible();
      await expect(counter).toHaveText(selectedBeforeFilter ?? '');
    });
  });
});
