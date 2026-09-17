import { TEST_ASSETS_BASE_URL } from '../../fixtures/index.js';
import { expect, test } from '../../fixtures/org.fixture.js';

const TEST_RUN_ID = Date.now();

/**
 * Settings · Scan your website — the REAL scan (ENG-659).
 *
 * The scan reads the owner's website and pulls services, packages, the venue
 * description, address, opening hours, team and brand into the account. It
 * lives on the Details card, next to the website field it reads, and opens a
 * dialog: choose what to look for, review a server-computed diff row by row,
 * apply it.
 *
 * WHY THIS LIVES IN `src/real/` AND NOT THE PR GATE
 * ------------------------------------------------
 * A run of this spec is billed work: one pass fans out across every scraping
 * strategy (Firecrawl / Browserbase / Browser Use) plus a GPT extraction, and
 * takes minutes. That is the same economics as
 * `src/real/onboarding/onboarding-website-analysis.spec.ts`, which moved here
 * for exactly this reason — nightly, single-worker, no retries — rather than
 * on every push. The cheap half of this surface (which sections the dialog
 * offers, and that the button stays disabled without a URL) stays on the gate
 * in `src/settings/website-scan.spec.ts`; only the crawl moved.
 *
 * No mocking — this hits the real scraping engine and the real model. The SITE
 * is ours: `clinic-fixture.html` is a committed fixture published to the
 * public E2E prefix by scripts/ensure-e2e-test-assets.sh, so it is genuinely
 * crawled over HTTP (SSRF guard, Firecrawl and all) while serving content we
 * version here. It used to crawl baysidebeautyclinic.com, a real third-party
 * clinic, which answers CI's datacenter IPs with 401/403.
 */

// Ten priced services — comfortably past the review dialog's COLLAPSE_AFTER=6
// (plan-section.tsx), which the "show N more" click below depends on.
//
// `?run=` is a CACHE BUSTER, and it is load-bearing (same reasoning as the
// onboarding spec): analyze-website caches its whole result in Redis under the
// URL for 24 hours, so a fixed URL would let this spec go green by reading
// yesterday's JSON without scanning anything. A per-run URL forces the
// pipeline to actually run. S3 ignores the unknown query param and serves the
// object.
const WEBSITE_URL = `${TEST_ASSETS_BASE_URL}/clinic-fixture.html?run=${TEST_RUN_ID}`;

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

/** Open the Details page with a website set, and open the scan dialog. */
const openScanDialog = async (page: import('@playwright/test').Page) => {
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

  // The scan reads the field directly, so it unlocks as soon as there is a URL.
  await page.getByRole('button', { name: /scan my website/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
};

test.describe('Settings · scan your website (real crawl)', () => {
  test('a scoped scan diffs row by row and applies only what stays ticked', async ({
    org,
  }) => {
    // A real crawl of the (small, static, ours) fixture site, a real model
    // pass, and the apply of every row it finds.
    test.setTimeout(300_000);

    const { page, seed } = org;
    const dialog = await openScanDialog(page);

    await test.step('scan for services only', async () => {
      // Leave only "Services & prices" on. `scanFor` narrows the PROMPT, not
      // just the apply, so the sections turned off here should be absent from
      // the diff entirely rather than present-but-empty.
      for (const label of SECTION_LABELS.slice(1)) {
        await dialog
          .getByRole('checkbox', { name: new RegExp(label) })
          .uncheck();
      }

      await dialog.getByRole('button', { name: /^scan my website$/i }).click();
    });

    await test.step('the diff carries services and nothing else', async () => {
      // The fixture crawl is near-instant; this budget is for the scraping
      // fan-out and the model pass. 4 minutes, not the 2 it carried on the
      // gate: that 120s was the exact edge it died on there (run
      // 33197139541 — three attempts, "element(s) not found" at 2.0m each),
      // and `real-e2e` gives the file 10, so there is no reason to keep the
      // budget that made a slow-but-working pipeline read as a failure.
      await expect(
        dialog.getByRole('heading', { name: 'Services & prices' })
      ).toBeVisible({ timeout: 240_000 });

      // The unchecked sections must not appear at all.
      for (const label of SECTION_LABELS.slice(1)) {
        await expect(dialog.getByRole('heading', { name: label })).toHaveCount(
          0
        );
      }
    });

    // The headline of ENG-659's review step: a real site yields dozens of
    // scraped services and some are SEO page titles, so the owner must be able
    // to drop ONE without losing the rest. Un-ticking a row has to move the
    // count and shrink what Apply commits to.
    const applyButton = dialog.getByRole('button', {
      name: /^apply \d+ changes?$/i,
    });

    /**
     * How many services the account holds right now, straight from the API.
     *
     * `limit=1`, because `listServicesSchema` caps `limit` at 100 — the
     * obvious `limit=200` is rejected with a 400, and since the old body
     * carried neither `total` nor `items` the count silently degraded to 0 and
     * the delta assertion below compared 0 against 0 + ticked.
     *
     * The page size is irrelevant anyway: `total` is the FULL count, not the
     * page's, so one row is enough to read it. Asserted rather than defaulted,
     * so a shape change fails loudly instead of counting zero again.
     */
    const countServices = async () => {
      const res = (await seed.authenticatedApiCall(
        'GET',
        '/organization-services?limit=1&offset=0'
      )) as { total?: number };
      expect(
        res.total,
        'GET /organization-services should report a total'
      ).toBeDefined();
      return res.total as number;
    };

    const servicesBefore = await countServices();

    const { droppedText } =
      await test.step('un-ticking one row drops only that row', async () => {
        const label = await applyButton.textContent();
        const startCount = Number(/\d+/.exec(label ?? '')?.[0] ?? '0');
        expect(startCount).toBeGreaterThan(1);

        // Expand the services list so a concrete row is reachable.
        await dialog
          .getByRole('button', { name: /show \d+ more/i })
          .first()
          .click();

        // Plan rows carry a `row-` id; the setup checklist carries `scan-`, so
        // this cannot pick up a section toggle by accident.
        const dropped = dialog.locator('[role="checkbox"][id^="row-"]').first();
        // The row's visible content, captured BEFORE unticking — this is what
        // must be absent from the account afterwards.
        const droppedText = (
          await dropped.locator('xpath=../span').innerText()
        ).trim();
        await dropped.uncheck();

        await expect(applyButton).toHaveText(
          new RegExp(`apply ${startCount - 1} changes?`, 'i')
        );
        return { count: startCount - 1, droppedText };
      });

    await test.step('applying persists exactly the rows left ticked', async () => {
      await applyButton.click();

      // The toast means "accepted", not "landed" — re-read from the server.
      await expect(dialog).toBeHidden({ timeout: 180_000 });

      // Asserted by NAME, not by arithmetic.
      //
      // `servicesBefore + ticked` assumed every ticked row inserts, but
      // applyWebsiteAnalysis keys services on a lowercased name (`nameKey` →
      // `serviceIdByName`), so a row whose name already exists is an UPDATE,
      // and an update does not move the total. The count then runs short by
      // exactly the number of collisions — nothing to do with what was ticked.
      //
      // What the test is actually for is the un-ticked row not being written,
      // so assert that directly. It holds whether a row inserts or updates.
      const after = (await seed.authenticatedApiCall(
        'GET',
        '/organization-services?limit=100&offset=0'
      )) as { items?: { name: string }[] };
      const names = (after.items ?? []).map((s) => s.name.toLowerCase());

      expect(names).not.toContain(droppedText.toLowerCase());
      // And the apply did land something: the ticked rows cannot all have been
      // no-ops, or "applies only what stays ticked" would be vacuous.
      expect(await countServices()).toBeGreaterThan(servicesBefore);

      // A section that was never scanned must not have been written. This is
      // the no-hallucination guarantee: an unchecked section cannot appear in
      // the prompt, so it cannot come back with invented rows.
      const packages = (await seed.authenticatedApiCall(
        'GET',
        '/packages?limit=100&offset=0'
      )) as { total?: number; items?: unknown[] };

      expect(packages.total ?? packages.items?.length ?? 0).toBe(0);
    });
  });
});
