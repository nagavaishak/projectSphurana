import { gotoSurface } from '../fixtures/app.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Settings · Bookings — the org's booking-policy form (`BookingsTab`, rendered at
 * /dashboard/settings/bookings). Unlike the Details tab (which reads
 * `GET /organizations/:id`), this form hydrates from `GET organization/active`
 * and writes with `PATCH organization/active`, so the `e2e_test_`-prefixed
 * fixture org id is a non-issue — the form fully round-trips.
 *
 * These are DEEP flows: drive the real inputs, submit, then RELOAD and re-read
 * the persisted values (the update hook invalidates + resets the form from the
 * server, and pops a "Organization settings updated" toast on success). One
 * inline form, no dialogs, identical PageShell markup at both viewports — so the
 * same script passes under `tabs` (desktop) and `tabs-mobile` (Pixel 7).
 *
 * Covers two Fresha-critical policy surfaces that previously had only
 * "tab renders" coverage:
 *   - Deposit settings (the `org.depositEnabled` surface) — toggle + amount.
 *   - Rescheduling policy — notice window + late-cancel/no-show fee.
 */
test.describe('Settings · bookings policy', () => {
  test('enabling a booking deposit + amount persists', async ({ org }) => {
    const { page } = org;
    await gotoSurface(page, '/dashboard/settings/bookings');

    // Form is behind a loading skeleton until `organization/active` resolves;
    // the "Booking Method" legend proves the real form mounted (default mode is
    // 'borradh', so the deposit section renders).
    await expect(page.getByText('Booking Method')).toBeVisible({
      timeout: 20_000,
    });

    const depositSwitch = page.getByRole('switch', {
      name: 'Require a booking deposit',
    });
    await expect(depositSwitch).toBeVisible({ timeout: 15_000 });

    // A fresh org defaults to deposits OFF — assert that (rather than branching
    // on it), then turn them on ⇒ the amount input appears (gated on the
    // `depositEnabled` watch).
    await expect(depositSwitch).not.toBeChecked();
    await depositSwitch.click();
    await expect(depositSwitch).toBeChecked();

    const amount = page.getByLabel('Deposit amount');
    await expect(amount).toBeVisible({ timeout: 10_000 });
    await amount.fill('30');

    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByText('Organization settings updated')).toBeVisible({
      timeout: 15_000,
    });

    // Reload and re-read from the server — the form resets from
    // `organization/active`, so this asserts real persistence (amount is stored
    // in cents server-side and shown back in major units: 3000 ⇒ "30").
    await gotoSurface(page, '/dashboard/settings/bookings');
    await expect(page.getByText('Booking Method')).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole('switch', { name: 'Require a booking deposit' })
    ).toBeChecked({ timeout: 15_000 });
    await expect(page.getByLabel('Deposit amount')).toHaveValue('30', {
      timeout: 15_000,
    });
  });

  test('rescheduling notice + late-cancel fee persist', async ({ org }) => {
    const { page } = org;
    await gotoSurface(page, '/dashboard/settings/bookings');

    // The Rescheduling Policy fieldset renders unconditionally once the form
    // hydrates.
    await expect(page.getByText('Rescheduling Policy')).toBeVisible({
      timeout: 20_000,
    });

    const fee = page.getByLabel('Late Cancel / No-Show Fee');
    // The notice control is a 0–48h Slider, not a text input. Its accessible
    // name sits on the Radix root; the focusable, value-bearing element is the
    // thumb (role="slider") nested inside it.
    const noticeThumb = page
      .getByLabel('Notice Required (hours)')
      .getByRole('slider');
    await expect(noticeThumb).toBeVisible({ timeout: 15_000 });

    // Drive it with the keyboard — `End` jumps a Radix slider to its max (48).
    await noticeThumb.focus();
    await noticeThumb.press('End');
    await expect(noticeThumb).toHaveAttribute('aria-valuenow', '48');
    // Fee input shows whole major-currency units; typing 15 persists 1500 cents.
    await fee.fill('15');

    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByText('Organization settings updated')).toBeVisible({
      timeout: 15_000,
    });

    await gotoSurface(page, '/dashboard/settings/bookings');
    await expect(page.getByText('Rescheduling Policy')).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByLabel('Notice Required (hours)').getByRole('slider')
    ).toHaveAttribute('aria-valuenow', '48', { timeout: 15_000 });
    // 1500 cents ⇒ displayed as "15" (Math.round(value / 100)).
    await expect(page.getByLabel('Late Cancel / No-Show Fee')).toHaveValue(
      '15',
      { timeout: 15_000 }
    );
  });
});
