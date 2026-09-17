import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Settings · Scan your website — the parts that cost nothing (ENG-659).
 *
 * The scan reads the owner's website and pulls services, packages, the venue
 * description, address, opening hours, team and brand into the account. It
 * lives on the Details card, next to the website field it reads, and opens a
 * dialog: choose what to look for, review a server-computed diff row by row,
 * apply it.
 *
 * WHAT THIS FILE COVERS, AND WHAT IT DELIBERATELY DOES NOT
 * -------------------------------------------------------
 * These two tests open the dialog and read the affordance — they never press
 * the scan button inside it, so no crawl and no model pass happens. That keeps
 * the PR gate free of billed, minutes-long third-party work while still
 * failing if a scannable section disappears or the entry point stops guarding
 * on an empty website field.
 *
 * The real thing — a genuine crawl of our published fixture site, the diff,
 * un-ticking a row and applying — lives in
 * `src/real/settings/website-scan.spec.ts` and runs nightly in the `real-e2e`
 * project, beside the other billed specs.
 *
 * A URL only has to be PRESENT for the dialog to open; nothing fetches it
 * here, which is why this is a plain literal rather than the crawlable
 * fixture the nightly spec uses.
 */
const WEBSITE_URL = 'https://example.com';

/** The seven sections the dialog offers, by their visible checkbox label. */
const SECTION_LABELS = [
  'Services & prices',
  'Packages & bundles',
  'Business description',
  'Location & address',
  'Opening hours',
  'Team members',
  'Brand details',
] as const;

test.describe('Settings · scan your website', () => {
  test('the dialog offers every scannable section', async ({ org }) => {
    const { page } = org;

    await page.goto('/dashboard/settings/details', {
      waitUntil: 'domcontentloaded',
    });

    // `getByRole('textbox')`, not `getByLabel` — the sidebar carries a nav link
    // to /dashboard/website whose aria-label is also exactly "Website", so a
    // label-only query matches two elements and dies on strict mode. The role
    // disambiguates without reaching for a test id.
    const websiteField = page.getByRole('textbox', { name: /^website$/i });
    await expect(websiteField).toBeVisible({ timeout: 30_000 });
    await websiteField.fill(WEBSITE_URL);

    // The scan reads the field directly, so it unlocks as soon as there is a
    // URL. Opening the dialog scans nothing — the crawl starts on the button
    // INSIDE it, which this spec never presses.
    await page.getByRole('button', { name: /scan my website/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // One checkbox per analysis section, all on by default — a section that
    // silently disappears here is a section the owner can no longer scan.
    for (const label of SECTION_LABELS) {
      const checkbox = dialog.getByRole('checkbox', {
        name: new RegExp(label),
      });
      await expect(checkbox).toBeVisible();
      await expect(checkbox).toBeChecked();
    }
  });

  test('the scan is unavailable until there is a website to read', async ({
    org,
  }) => {
    const { page } = org;

    await page.goto('/dashboard/settings/details', {
      waitUntil: 'domcontentloaded',
    });

    const websiteField = page.getByRole('textbox', { name: /^website$/i });
    await expect(websiteField).toBeVisible({ timeout: 30_000 });
    await websiteField.fill('');

    await expect(
      page.getByRole('button', { name: /scan my website/i })
    ).toBeDisabled();
  });
});
