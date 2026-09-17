import { gotoSurface } from '../fixtures/app.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Settings · Notifications — the preferences form. Each control saves on change
 * (optimistic `useUpdateNotificationPreferences` → `PUT notification-preferences`,
 * invalidates on settle). There's no explicit Save button and no success toast,
 * so persistence is asserted by RELOADING and re-reading the switch state.
 *
 * The "Marketing emails" switch is the cleanest round-trip: its accessible name
 * comes from the associated <Label>, it's a single top-level boolean (not nested
 * in the granular preferences JSON), and it renders identically at both
 * viewports. Same script passes under `tabs` and `tabs-mobile`.
 */
test.describe('Settings · notifications', () => {
  test('toggling a marketing preference persists across reload', async ({
    org,
  }) => {
    const { page } = org;
    await gotoSurface(page, '/dashboard/settings/notifications');

    // Card copy proves the real form mounted (not the loading skeleton / empty
    // fallback).
    await expect(
      page.getByText(/Choose which events reach you and how/i)
    ).toBeVisible({ timeout: 20_000 });

    const marketing = page.getByRole('switch', { name: 'Marketing emails' });
    await expect(marketing).toBeVisible({ timeout: 15_000 });

    // Flip to the opposite of the current server value, and wait for the write
    // to land before reloading (the mutation is optimistic; reloading before the
    // PUT resolves could race the invalidation refetch back to the old value).
    const wasChecked =
      (await marketing.getAttribute('aria-checked')) === 'true';
    const savePut = page.waitForResponse(
      (res) =>
        res.url().includes('notification-preferences') &&
        res.request().method() === 'PUT' &&
        res.ok(),
      { timeout: 20_000 }
    );
    await marketing.click();
    await savePut;
    await expect(marketing).toHaveAttribute(
      'aria-checked',
      String(!wasChecked)
    );

    // Reload and confirm the flipped value came back from the server.
    await gotoSurface(page, '/dashboard/settings/notifications');
    await expect(
      page.getByText(/Choose which events reach you and how/i)
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole('switch', { name: 'Marketing emails' })
    ).toHaveAttribute('aria-checked', String(!wasChecked), { timeout: 15_000 });
  });
});
