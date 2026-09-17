import type { Page } from '@playwright/test';

import { isMobile } from '../fixtures/app.js';
import { branchUrl } from '../fixtures/branch.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Branch-scoped navigation — the coverage gap that let a real regression ship.
 *
 * Every branch surface moved to `/dashboard/l/:branch/…`, and a compatibility
 * splat was left behind to catch legacy `/dashboard/x` paths and redirect them.
 * The splat did its job so well that it hid a bug: the desktop sidebar was
 * still rendering `<Link to={section.url}>` straight from the UN-PREFIXED
 * `BRANCH_PATHS` constants, so every sidebar click went out as
 * `/dashboard/home` and only landed because the splat bounced it.
 *
 * No spec caught that, because every spec asserted the surface it ended up on
 * and the redirect made that assertion true. What was missing is an assertion
 * on the LINK ITSELF — that the app produces branch-scoped URLs rather than
 * merely tolerating legacy ones. When the splat is deleted these are what stand
 * between a working sidebar and a wall of 404s.
 */
/**
 * Org-level destinations legitimately stay at `/dashboard/*` — settings,
 * account, more, locations, the debug pages. Everything else the sidebar links
 * to is a branch surface and must carry `/dashboard/l/<branch>/`.
 */
const ORG_LEVEL = [
  '/dashboard/settings',
  '/dashboard/account',
  '/dashboard/more',
  '/dashboard/locations',
  '/dashboard/organisation',
  '/dashboard/intake-forms',
  '/dashboard/website',
  '/dashboard/debug',
  // Org-wide analytics. These exist ONLY at org level — there is no
  // /dashboard/l/:id/retention — so an un-prefixed link to them is correct,
  // not the regression this test hunts. An owner asks these questions about
  // the business, not about one site.
  '/dashboard/retention',
  '/dashboard/reviews',
  '/dashboard/reports',
];

/**
 * Every un-prefixed branch link the sidebar is currently rendering.
 *
 * Reads `href` rather than clicking, deliberately: this is about what the app
 * EMITS. A click would be caught by the compatibility splat and land on the
 * right page either way, which is exactly how the regression stayed invisible.
 */
async function legacyBranchLinks(page: Page): Promise<string[]> {
  const hrefs = await page
    .locator('[data-slot="sidebar"]')
    .locator('a[href^="/dashboard/"]')
    .evaluateAll((anchors) =>
      anchors.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '')
    );

  expect(hrefs.length, 'sidebar rendered no dashboard links').toBeGreaterThan(
    0
  );

  return hrefs.filter(
    (href) =>
      !href.startsWith('/dashboard/l/') &&
      !ORG_LEVEL.some(
        (prefix) => href === prefix || href.startsWith(`${prefix}/`)
      )
  );
}

test.describe('branch-scoped navigation', () => {
  test('the sidebar links into the active branch, not the legacy path', async ({
    org,
  }) => {
    const { page } = org;
    test.skip(isMobile(page), 'Desktop sidebar; mobile uses the bottom tabs.');

    await page.goto(await branchUrl(page, '/dashboard/home'), {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('[data-sidebar="menu-button"]').first().waitFor();

    const legacy = await legacyBranchLinks(page);
    expect(
      legacy,
      `sidebar emitted un-prefixed branch links (these only work while the compatibility splat exists):\n${legacy.join('\n')}`
    ).toEqual([]);
  });

  test('an org-level page still links back into a branch', async ({ org }) => {
    const { page } = org;
    test.skip(isMobile(page), 'Desktop sidebar; mobile uses the bottom tabs.');

    // `/dashboard/settings` has no branch in the URL, so the sidebar has to
    // recover one from the remembered branch or the org's primary. This is the
    // case `useResolvedRoutes` gets wrong — it falls back to the un-prefixed
    // paths — which is why the sidebar resolves through `useActiveLocation`.
    await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-sidebar="menu-button"]').first().waitFor();

    // POLLED, unlike the two tests above, and the difference is the URL.
    //
    // They navigate to a path that already CONTAINS the branch, so
    // `useResolvedRoutes` reads it straight off the pathname and the very first
    // paint is already prefixed — a single read is sound there. This one is on
    // `/dashboard/settings`, where the branch has to be recovered from the
    // locations query, so the first paint legitimately emits the un-prefixed
    // fallback and only settles once the query lands.
    //
    // Safe to poll `legacyBranchLinks` directly: the caller has already waited
    // for a sidebar menu button, so its internal "rendered no dashboard links"
    // guard cannot fire mid-poll and abort the retry.
    await expect
      .poll(() => legacyBranchLinks(page), {
        timeout: 15_000,
        message:
          'sidebar on an org-level page never resolved past the un-prefixed fallback links.',
      })
      .toEqual([]);
  });

  test('clicking through the sidebar keeps the branch in the URL', async ({
    org,
  }) => {
    const { page } = org;
    test.skip(isMobile(page), 'Desktop sidebar; mobile uses the bottom tabs.');

    await page.goto(await branchUrl(page, '/dashboard/home'), {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('[data-sidebar="menu-button"]').first().waitFor();

    const branch = new URL(page.url()).pathname.split('/')[3];
    expect(branch, `expected a branch segment in ${page.url()}`).toBeTruthy();

    // Calendar is a section with no sub-items, so one click is one navigation.
    await page
      .locator('[data-slot="sidebar"]')
      .getByRole('link', { name: 'Calendar' })
      .first()
      .click();

    await expect(page).toHaveURL(new RegExp(`/dashboard/l/${branch}/calendar`));
  });
});

/**
 * The mobile "More" drill-down is a second nav surface off the SAME config, and
 * it had the same defect: `<Link to={item.url}>` straight from the un-prefixed
 * constants. Every row on `/dashboard/more/sales`, `/catalog`, `/marketing`,
 * `/team` and `/inventory` went through the splat.
 */
test.describe('the More drill-down links into the active branch', () => {
  for (const slug of ['sales', 'catalog', 'marketing', 'team', 'inventory']) {
    test(`/dashboard/more/${slug} rows carry the branch`, async ({ org }) => {
      const { page } = org;

      await page.goto(`/dashboard/more/${slug}`, {
        waitUntil: 'domcontentloaded',
      });

      const rows = page.locator('a[href^="/dashboard/"]');
      await rows.first().waitFor({ timeout: 15_000 });

      const legacyLinks = async () => {
        const hrefs = await rows.evaluateAll((anchors) =>
          anchors.map(
            (a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''
          )
        );
        return hrefs.filter(
          (href) =>
            !href.startsWith('/dashboard/l/') &&
            !ORG_LEVEL.some(
              (prefix) => href === prefix || href.startsWith(`${prefix}/`)
            )
        );
      };

      // POLLED, and the transient it polls past is real rather than incidental.
      //
      // `/dashboard/more/:slug` is an ORG-LEVEL url — no branch in the path — so
      // `useResolvedRoutes()` has to recover one, and on a cold load with nothing
      // remembered that means waiting for the locations query. Until it lands the
      // hook returns FALLBACK_ROUTES, which ARE the un-prefixed paths, so the
      // first paint legitimately emits exactly what this test is looking for.
      // `rows.first().waitFor()` is satisfied by that first paint, so a one-shot
      // read is a coin flip — it went red once and green on retry in CI while
      // passing locally every time.
      //
      // The settled state is the right thing to assert: a click during the
      // transient still lands, via the compatibility splat, at the documented
      // cost of one redirect.
      await expect
        .poll(legacyLinks, {
          timeout: 15_000,
          message: `More › ${slug} still emitted un-prefixed branch links after the branch resolved.`,
        })
        .toEqual([]);
    });
  }
});

/**
 * The compatibility splat must redirect ONCE, never re-prefix itself.
 *
 * It catches anything under `/dashboard` that matched no route — and
 * `/dashboard/l/<branch>/nonsense` is such a path, so without a guard it came
 * back through and got another `/l/<branch>` prepended, and again:
 * `/dashboard/l/main/l/main/l/main/…` several hundred segments deep. Every
 * unknown dashboard URL — a typo, a stale bookmark, a legacy deep link whose
 * target moved — was an unbounded redirect loop rather than a not-found.
 *
 * Asserted on the SHAPE of the landing URL rather than on a 404 body, because
 * the loop still "navigated" and still rendered app chrome; only the repeated
 * segments gave it away.
 */
test.describe('the compatibility splat does not loop', () => {
  for (const path of [
    '/dashboard/totally-made-up',
    '/dashboard/conversations/conv-abc123',
    '/dashboard/l/main/nonsense',
  ]) {
    test(`${path} resolves once`, async ({ org }) => {
      const { page } = org;

      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);

      const landed = new URL(page.url()).pathname;
      const branchSegments = landed.split('/').filter((s) => s === 'l').length;

      expect(
        branchSegments,
        `${path} landed on ${landed} — the splat re-prefixed a path it had already prefixed.`
      ).toBeLessThanOrEqual(1);
    });
  }
});
