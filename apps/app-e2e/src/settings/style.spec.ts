import { gotoSurface } from '../fixtures/app.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Settings · Style — the brand-defaults form (`StyleSettingsCard`). Writes via
 * the same `useUpdateOrganization` → `PATCH organization/active` path as the
 * Bookings tab (success toast "Organization settings updated"), reading brand +
 * org via `useGetOrganization`/`useGetOrganizationBrand`. The Save button is
 * gated on `formState.isDirty`, so the flow must actually change a field.
 *
 * The Brand style guide textarea is the cleanest round-trip: free text, single
 * field, no currency/unit conversion. Reload-and-re-read asserts real
 * persistence. One inline card at both viewports ⇒ passes under `tabs` and
 * `tabs-mobile`.
 */
test.describe('Settings · style', () => {
  test('editing the brand style guide persists', async ({ org }) => {
    const { page } = org;
    const guide = `E2E brand guide ${Date.now()} — navy headings, gold accents.`;

    await gotoSurface(page, '/dashboard/settings/style');

    const textarea = page.getByLabel('Brand style guide');
    await expect(textarea).toBeVisible({ timeout: 20_000 });

    await textarea.fill(guide);

    // Save enables only once the form is dirty (the fill above).
    const save = page.getByRole('button', { name: 'Save changes' });
    await expect(save).toBeEnabled({ timeout: 10_000 });
    await save.click();

    await expect(page.getByText('Organization settings updated')).toBeVisible({
      timeout: 15_000,
    });

    // Reload and re-read from the server.
    await gotoSurface(page, '/dashboard/settings/style');
    await expect(page.getByLabel('Brand style guide')).toHaveValue(guide, {
      timeout: 20_000,
    });
  });
});
