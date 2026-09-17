import { expect, test } from '@playwright/test';
import { branchUrl } from '../fixtures/branch.fixture.js';
import {
  makeDeterministic,
  masksFor,
  waitForVisualStability,
} from './determinism.js';
import { SKIPPED_ROUTES, snapshotName, visualRoutes } from './routes.js';

/**
 * Visual regression — authenticated surfaces.
 *
 * One capture per discovered route per viewport, diffed against the approved
 * baseline committed under `__screenshots__/`. The route list is DERIVED from
 * the app's generated route tree (see routes.ts), so a new surface enters the
 * inventory the moment it ships rather than when somebody remembers to add it.
 *
 * The diff here is deliberately dumb: it answers "did these pixels change",
 * never "does that matter". Adjudication — intended change vs regression — is a
 * separate stage (scripts/visual-qa/adjudicate.mjs) that only ever looks at the
 * regions this stage flagged. Keeping detection dumb and judgement separate is
 * what lets the whole loop run without a human triaging diffs.
 *
 * A failure here is NOT automatically a bug. It means "this surface changed and
 * nobody has said whether that was intended".
 */

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  // Responsive breakage is otherwise invisible: every other visual check in
  // the suite runs at desktop width, so a layout that collapses at phone size
  // ships unnoticed.
  { name: 'mobile', width: 390, height: 844 },
] as const;

const routes = visualRoutes();

test.describe('visual regression — authenticated', () => {
  // Captures are pure reads. Running them in parallel is safe and the
  // inventory is large enough that serialising it would dominate the run.
  test.describe.configure({ mode: 'parallel' });

  for (const viewport of VIEWPORTS) {
    test.describe(viewport.name, () => {
      for (const route of routes) {
        test(`${route} @ ${viewport.name}`, async ({ page }) => {
          await page.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          });
          await makeDeterministic(page);

          // The inventory holds un-prefixed sub-paths; `branchUrl` resolves
          // the branch-scoped ones to `/dashboard/l/<branch>/…` at navigation
          // time. Keeping the branch OUT of `route` is what keeps
          // `snapshotName` stable — a handle in the filename would orphan
          // every baseline the first time an org's slug changed.
          await page.goto(await branchUrl(page, route));
          await waitForVisualStability(page);

          await expect(page).toHaveScreenshot(
            snapshotName(route, viewport.name),
            { fullPage: true, mask: masksFor(page) }
          );
        });
      }
    });
  }
});

/**
 * Coverage audit. The inventory is generated, so the only way a surface escapes
 * capture is via SKIPPED_ROUTES — and every entry there carries a reason. This
 * test fails if a route is skipped without one, which stops the skip list from
 * quietly becoming the place coverage goes to die.
 */
test('every skipped route documents why', () => {
  const undocumented = Object.entries(SKIPPED_ROUTES)
    .filter(([, reason]) => !reason || reason.trim().length < 10)
    .map(([route]) => route);

  expect(
    undocumented,
    `These routes are skipped without a reason. Either document why the route cannot be captured, or remove it from SKIPPED_ROUTES so it is covered:\n${undocumented.join('\n')}`
  ).toHaveLength(0);
});

test('the route inventory is not empty', () => {
  // A parser change or a moved routeTree.gen.ts would silently reduce the
  // inventory to nothing, and an empty suite passes. Assert it found routes.
  expect(
    routes.length,
    'Route discovery returned nothing — routeTree.gen.ts likely moved or changed shape (see src/visual/routes.ts).'
  ).toBeGreaterThan(50);
});
