import { isMobile } from '../fixtures/app.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Rooms & equipment follow the branch you are standing in.
 *
 * THE GAP THIS CLOSES. Branch scoping for resources is enforced in three
 * places — the SQL predicate, the controller's `@ActiveLocation()`, and the
 * frontend's `ActiveLocationScope` publishing `X-Location-Id` — and each is
 * covered on its own. Nothing asserted the three composing: that a user who
 * switches branch in the switcher sees a different set of rooms. Every layer
 * can be individually correct while the header never reaches the request.
 *
 * NO SPEC IN THIS SUITE CREATED A SECOND BRANCH before this one, so branch
 * isolation was unasserted end to end by construction: with one branch, a
 * dropped header and a correct one produce identical output.
 *
 * The trolley is the load-bearing fixture. A resource with NO branch belongs
 * to all of them, and a filter written as a bare equality excludes precisely
 * the rows the nullable column exists for. It must appear on BOTH branches, so
 * this asserts its presence rather than only the other branch's absence — an
 * assertion that only checked "Cork Room is missing from Dublin" would pass
 * against a filter that returns nothing at all.
 */

interface Seeded {
  dublinHandle: string;
  corkHandle: string;
}

test.describe('rooms & equipment are branch-scoped', () => {
  /**
   * A second branch, a category, and three resources: one per branch plus one
   * belonging to neither.
   *
   * Seeded through the real API rather than the UI — this is the precondition,
   * not the subject. The subject is what the browser renders afterwards.
   */
  async function seedTwoBranches(
    seed: import('../fixtures/seed.fixture.js').SeedHelper
  ): Promise<Seeded> {
    // `{ items: [...] }`, not a bare array — same shape `branch.fixture.ts`
    // reads next door.
    const { items: locations } = (await seed.authenticatedApiCall(
      'GET',
      '/organization-locations'
    )) as { items: { id: string; slug: string | null; isPrimary: boolean }[] };

    // Same precedence as the app's `resolveEntryBranch()`: primary, else first.
    const dublin = locations.find((l) => l.isPrimary) ?? locations[0];
    expect(dublin, 'the org fixture provisioned no location').toBeTruthy();

    const cork = (await seed.authenticatedApiCall(
      'POST',
      '/organization-locations',
      {
        name: 'E2E Cork',
        addressLine1: '22 Oliver Plunkett Street',
        city: 'Cork',
        country: 'ie',
      }
    )) as { id: string; slug: string | null };

    const category = (await seed.authenticatedApiCall(
      'POST',
      '/resources/categories',
      {
        name: `E2E Rooms ${Date.now()}`,
        kind: 'room',
      }
    )) as { id: string };

    for (const [name, locationId] of [
      ['E2E Dublin Room', dublin.id],
      ['E2E Cork Room', cork.id],
      ['E2E Mobile Laser', null],
    ] as const) {
      await seed.authenticatedApiCall('POST', '/resources', {
        categoryId: category.id,
        name,
        locationId,
      });
    }

    // The handle is `slug ?? id` — the same rule the router uses.
    return {
      dublinHandle: dublin.slug ?? dublin.id,
      corkHandle: cork.slug ?? cork.id,
    };
  }

  /** The resource names the settings page is currently rendering. */
  async function visibleRooms(
    page: import('@playwright/test').Page
  ): Promise<string[]> {
    const rows = page.getByText(/^E2E (Dublin Room|Cork Room|Mobile Laser)$/);
    await rows.first().waitFor({ timeout: 20_000 });
    return (await rows.allTextContents()).map((t) => t.trim()).sort();
  }

  test('each branch shows its own rooms plus the location-less one', async ({
    org,
  }) => {
    const { page, seed } = org;
    const { dublinHandle, corkHandle } = await seedTwoBranches(seed);

    await page.goto(`/dashboard/l/${dublinHandle}/catalog/resources`, {
      waitUntil: 'domcontentloaded',
    });
    expect(await visibleRooms(page)).toEqual([
      'E2E Dublin Room',
      'E2E Mobile Laser',
    ]);

    await page.goto(`/dashboard/l/${corkHandle}/catalog/resources`, {
      waitUntil: 'domcontentloaded',
    });
    // Symmetric, and the trolley is in BOTH — the assertion a bare-equality
    // filter fails and an absent filter also fails.
    expect(await visibleRooms(page)).toEqual([
      'E2E Cork Room',
      'E2E Mobile Laser',
    ]);
  });

  test('switching branch in the switcher changes the rooms on screen', async ({
    org,
  }) => {
    const { page, seed } = org;
    test.skip(
      isMobile(page),
      'Desktop switcher; the mobile header has its own control.'
    );

    const { dublinHandle } = await seedTwoBranches(seed);

    await page.goto(`/dashboard/l/${dublinHandle}/catalog/resources`, {
      waitUntil: 'domcontentloaded',
    });
    expect(await visibleRooms(page)).toContain('E2E Dublin Room');

    // Through the actual control, not a URL. The header the API reads is
    // published by `ActiveLocationScope` off the switcher's state — driving
    // the URL directly would exercise the router and skip that seam entirely,
    // which is the seam this test exists for.
    await page
      .getByRole('button', { name: /Location: .*Change location/i })
      .first()
      .click();
    await page.getByRole('menuitem', { name: /E2E Cork/i }).click();

    await expect(page).toHaveURL(/\/dashboard\/l\/[^/]+\/catalog\/resources/);
    await expect(page).not.toHaveURL(
      new RegExp(`/dashboard/l/${dublinHandle}/`)
    );

    // POLLED, because a switch is a REFETCH and not a navigation.
    //
    // `visibleRooms` waits for the first matching row and then snapshots. After
    // a `goto` that is sound — the page remounted, so the only rows that can
    // appear are the new branch's. After a switch the OLD rows are still on
    // screen, so that wait returns instantly and the snapshot captures them.
    //
    // Measured, the list goes `[Dublin] → [] → [Cork]`: it empties while the
    // query refetches, then fills. A single read can therefore land on the
    // stale set OR the empty gap, depending on how the machine is feeling —
    // which is exactly what happened on CI, where it read the stale Dublin set
    // three times in a row while passing locally every time.
    //
    // One settled comparison rather than three separate `toContain`s: it
    // subsumes all three (Cork present, Dublin gone, the location-less trolley
    // still there) and cannot pass against a half-updated list.
    await expect
      .poll(() => visibleRooms(page), { timeout: 20_000 })
      .toEqual(['E2E Cork Room', 'E2E Mobile Laser']);
  });
});
