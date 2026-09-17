import { expect, test } from '@playwright/test';
import { SeedHelper } from './fixtures/index.js';

/**
 * Style settings smoke (apps/app).
 *
 * Route: /dashboard/settings/style — consolidated on the video-editor branch
 * into a single "Style" card holding the business logo, brand colours, the
 * background-music volume default, and the graphic style preference. (Caption
 * font/position are no longer org-level — they live in the per-video create
 * flow.) Real API (useGetOrganization / useGetOrganizationBrand); no mocking.
 * Auth via the `authenticated` project's bare-org storageState.
 *
 * This is a render smoke — it confirms the card mounts with its controls and a
 * save affordance is present. It does not submit (that would mutate the shared
 * bare org's branding for every other test).
 */

test.describe('Style settings', () => {
  test('renders the style card with logo, colours and graphic style', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    await seed.gotoDashboardPage('/dashboard/settings/style');

    // The card hydrates after the org + brand queries resolve. Match on the
    // card description (unique on the page) to confirm the card mounted.
    await expect(
      page.getByText(/Your logo, brand colours, and defaults/i)
    ).toBeVisible({ timeout: 30_000 });

    // shadcn FieldLabel renders as a <label>; match the exact label text so we
    // don't also hit longer strings that embed these words (e.g. the brand
    // style-guide copy), which would trip Playwright's strict mode.
    await expect(
      page.getByText('Business logo', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('Primary colour', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('Secondary colour', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('Graphic style', { exact: true })
    ).toBeVisible();

    // Save submit is present (disabled until the form is dirty).
    await expect(
      page.getByRole('button', { name: /save changes/i })
    ).toBeVisible();
  });

  test('exposes music volume and graphic style controls', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    await seed.gotoDashboardPage('/dashboard/settings/style');

    // The label renders "Music volume — N%". Scope to that em-dash + percentage
    // form so we don't also match the field description ("Background music
    // volume relative to narration."), which would trip strict mode.
    await expect(page.getByText(/Music volume — \d+%/)).toBeVisible({
      timeout: 30_000,
    });
    // Radix renders role="slider" on the thumb, which has no accessible name
    // (the aria-label sits on the Slider root), so don't filter by name — the
    // style card has exactly one slider.
    await expect(page.getByRole('slider')).toBeVisible();

    // Graphic style is a Select combobox (Clean / Basic border preference).
    await expect(page.getByText('Graphic style')).toBeVisible();
    await expect(page.getByRole('combobox')).toBeVisible();
  });
});
