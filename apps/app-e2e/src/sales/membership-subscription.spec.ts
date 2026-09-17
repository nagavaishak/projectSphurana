import { entityEditorSave, gotoSurface, isMobile } from '../fixtures/app.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Sales tab — recurring MEMBERSHIP subscription lifecycle, driven END-TO-END
 * THROUGH THE UI, in the Stripe-stub E2E tier (see STRIPE-TIER.md §2/§4,
 * "recurring membership renew/cancel" row). Runs ONLY where `STRIPE_E2E_STUB=true`
 * on the target API: the stub swaps the Connect client (`getStripeConnectService()`),
 * so selling a recurring plan makes `createConnectedSubscription` return a
 * deterministic fake `sub_e2e_<uuid>` id instead of hitting Stripe — no real
 * subscription is created and no webhook secret is needed.
 *
 * Every step that has a UI affordance is driven in the browser:
 *   1. Create a RECURRING membership plan via the catalog/memberships UI.
 *   2. Seed a client (API precondition only), open its profile and click
 *      "New sale" — the new client-profile → POS entry point that pre-attaches
 *      the client to the sale. Assert the client shows inside checkout.
 *   3. Add the membership line via the POS "Membership" picker, pay cash, and
 *      complete the sale — all in the checkout overlay.
 *   4. On the client's Memberships tab, assert the plan card shows "Active".
 *   6. Cancel THROUGH THE UI ("Cancel membership" on the card + AlertDialog),
 *      assert the status Badge flips to "Cancelled".
 *
 * The ONLY non-UI event is the renewal (step 5): Stripe itself renews a
 * subscription — there is no in-app affordance for "the next billing cycle
 * elapsed". We read the stub `sub_e2e_*` id back (the sole permitted product-
 * state API read, since the id is minted server-side and unknowable up front),
 * inject one `customer.subscription.updated`, and then assert the advanced
 * "Valid until" date IN THE UI. Cancellation, by contrast, DOES have a UI
 * affordance, so we use it — never a `customer.subscription.deleted` injection.
 *
 * DESKTOP-ONLY: the POS checkout overlay is a fixed-width layout whose step
 * region collapses off-screen at mobile width (see checkout-qr.spec.ts). The
 * memberships tab itself is viewport-agnostic, but the sale must run at desktop.
 */
const STUB_ENABLED = process.env.STRIPE_E2E_STUB === 'true';

interface IdRow {
  id: string;
}
interface LeadMembershipRow {
  id: string;
  status: string;
  validUntil: string | null;
  stripeSubscriptionId: string | null;
  planId: string;
}

/** `GET /lead-memberships` returns the rows array (or `{ items }`). */
function asRows(res: unknown): LeadMembershipRow[] {
  if (Array.isArray(res)) return res as LeadMembershipRow[];
  const items = (res as { items?: LeadMembershipRow[] })?.items;
  return items ?? [];
}

test.describe('Sales · membership subscription lifecycle (stubbed Stripe)', () => {
  test('sell a recurring membership via the UI, then renew (injected) and cancel (UI)', async ({
    org,
  }) => {
    test.skip(
      !STUB_ENABLED,
      'Requires STRIPE_E2E_STUB on the target API (see STRIPE-TIER.md).'
    );
    const { page, orgId, seed } = org;
    test.skip(
      isMobile(page),
      'POS checkout overlay is a fixed-width desktop layout; the step region ' +
        'collapses off-screen at mobile width. Mobile POS is a separate flow.'
    );
    const api = seed.authenticatedApiCall.bind(seed);

    // A recurring plan is a Stripe subscription on the org's connected account —
    // `purchaseMembership` bails with INVALID_STATE unless an active,
    // charges-enabled connected account exists. Seed the stub `acct_e2e_*` one
    // FIRST (recurring plans need the Connect stub before the sale completes).
    await seed.seedStripeConnect({ organizationId: orgId });

    const ts = Date.now();
    const planName = `E2E Recurring ${ts}`;

    // --- 1. Create the RECURRING membership plan via the catalog UI ------------
    await gotoSurface(page, '/dashboard/catalog/memberships');
    // Header + empty-state both render an "Add membership" trigger on a fresh org.
    await page.getByRole('button', { name: 'Add membership' }).first().click();

    // The plan is created on the unified entity editor at `/create/membership`
    // — a FULL PAGE, not a dialog. This block used to scope every locator to
    // `getByRole('dialog')`, which can no longer match anything.
    await expect(
      page.getByRole('heading', { name: 'Add membership' })
    ).toBeVisible({ timeout: 15_000 });

    // Let the editor settle before typing.
    //
    // Against a DEV server the app runs under React StrictMode, which mounts,
    // unmounts and remounts — re-running the form's `useState` initialiser and
    // discarding anything typed in between. That is a dev-only artifact (CI
    // drives a production build, which does not double-mount), so this wait is
    // readiness handling for local runs, NOT cover for a product bug. The
    // `toHaveValue` below is what would catch a real hydration clobber.
    await page.waitForLoadState('networkidle');

    const nameBox = page.getByRole('textbox', { name: 'Name', exact: true });
    await nameBox.fill(planName);
    await expect(nameBox).toHaveValue(planName, { timeout: 5_000 });

    // Pricing → Recurring (flips "Valid for" to a "Billing period" select and
    // makes the sale provision a Stripe subscription).
    await page.getByRole('radio', { name: 'Recurring' }).click();
    await page.getByLabel('Price').fill('50');
    // The editor labels its action from `saveLabel`, and the mobile bar says
    // "Save Changes" — the shared helper picks whichever is on screen.
    await entityEditorSave(page).click();

    // The editor navigates back to the list and the plan lands in the table.
    await expect(
      page.getByRole('heading', { name: 'Add membership' })
    ).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(planName)).toBeVisible({ timeout: 15_000 });

    // --- 2. Seed a client (precondition), open its profile, click "New sale" ---
    const lead = (await api('POST', '/leads', {
      firstName: 'E2E',
      lastName: `Member${ts}`,
      email: `e2e.member.${ts}@example.com`,
    })) as IdRow;
    expect(lead.id, 'a client was created').toBeTruthy();
    const fullName = `E2E Member${ts}`;

    await gotoSurface(page, `/dashboard/customers/${lead.id}`);
    // The profile header renders the client's name — confirms we're on it.
    await expect(page.getByRole('heading', { name: fullName })).toBeVisible({
      timeout: 30_000,
    });

    // "New sale" opens the POS checkout overlay with THIS client pre-attached.
    await page.getByRole('button', { name: 'New sale' }).click();

    const checkout = page.getByRole('dialog', { name: 'Checkout' });
    await expect(
      checkout.getByRole('heading', { name: 'Add to cart' })
    ).toBeVisible({ timeout: 30_000 });
    // The pre-attached client shows in the checkout cart (not just the header
    // behind the overlay) — proves the entry point carried the leadId through.
    await expect(checkout.getByText(fullName)).toBeVisible({ timeout: 15_000 });

    // --- 3. Add the membership line via the POS picker, pay cash, complete -----
    await page.getByRole('button', { name: 'Membership' }).click();
    const membershipPicker = page.getByRole('dialog', {
      name: 'Add a membership',
    });
    await expect(membershipPicker).toBeVisible({ timeout: 15_000 });
    // Pick the recurring plan we just created (button's accessible name carries
    // the plan name + its price).
    await membershipPicker.getByRole('button', { name: planName }).click();
    await expect(membershipPicker).toBeHidden({ timeout: 15_000 });

    // Advance through tip to the payment step (Continue enables once the line
    // lands, i.e. `sale.items.length > 0`).
    const continueBtn = page.getByRole('button', {
      name: 'Continue',
      exact: true,
    });
    await expect(continueBtn).toBeEnabled({ timeout: 15_000 });
    await continueBtn.click();
    await page
      .getByRole('button', { name: 'Continue to payment' })
      .click({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: 'Select payment' })
    ).toBeVisible({ timeout: 15_000 });

    // Pay the full balance in CASH — settles instantly, auto-completes the sale,
    // and `completeSale` provisions the membership (stub subscription created).
    await page.getByRole('button', { name: 'Cash', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Add cash amount' })
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // The POS adds every tender with `autoComplete: false` (payment-panel.tsx),
    // so the fully-paid sale stays `open` until the operator confirms — the
    // "Complete sale" action MUST render, and clicking it is what runs
    // `completeSale` (which provisions the membership).
    const completeBtn = page.getByRole('button', { name: 'Complete sale' });
    await expect(completeBtn).toBeVisible({ timeout: 15_000 });
    await completeBtn.click();
    await expect(
      page.getByRole('heading', { name: 'Sale complete' })
    ).toBeVisible({ timeout: 30_000 });

    // --- 4. Assert the membership shows "Active" on the client's tab ----------
    await gotoSurface(page, `/dashboard/customers/${lead.id}`);
    await page.getByRole('tab', { name: 'Memberships' }).click();
    await expect(page.getByText(planName)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Active', { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Read the initial "Valid until" as rendered — the value <p> immediately
    // after the "Valid until" label <p> inside the card.
    const validUntilValue = () =>
      page
        .getByText('Valid until', { exact: true })
        .locator('xpath=following-sibling::p[1]');
    const initialValidUntil = (await validUntilValue().textContent())?.trim();
    expect(initialValidUntil, 'a "Valid until" date is shown').toBeTruthy();

    // --- 5. Renewal: the SOLE non-UI event ------------------------------------
    // Stripe renews subscriptions server-side; there is no in-app affordance for
    // "the next billing cycle elapsed". Discover the stub `sub_e2e_*` id (minted
    // server-side, unknowable up front) — the only permitted product-state API
    // read — then inject one `customer.subscription.updated`. The handler mirrors
    // current_period_end onto lead_membership.validUntil.
    let membership: LeadMembershipRow | undefined;
    await expect
      .poll(
        async () => {
          const rows = asRows(
            await api('GET', `/lead-memberships?leadId=${lead.id}`)
          );
          // The fresh org's lone client bought exactly one membership — the row
          // carrying a stub subscription id is unambiguous.
          membership = rows.find((m) => !!m.stripeSubscriptionId);
          return membership?.stripeSubscriptionId ?? null;
        },
        {
          message:
            'the completed sale provisioned a lead_membership with a stub ' +
            'subscription id (sub_e2e_*)',
          timeout: 30_000,
        }
      )
      .toMatch(/^sub_e2e_/);
    const subscriptionId = membership?.stripeSubscriptionId as string;

    const renewalPeriodEndSec =
      Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60;
    const renewal = await seed.simulateStripeWebhook({
      eventType: 'customer.subscription.updated',
      stripeSubscriptionId: subscriptionId,
      stripeStatus: 'active',
      currentPeriodEndSec: renewalPeriodEndSec,
    });
    expect(renewal.processed, 'renewal webhook updated the membership').toBe(
      true
    );

    // The card renders validUntil via date-fns 'd MMM yyyy'. Node's full-ICU
    // en-GB abbreviates September as "Sept" (4 letters) whereas date-fns emits
    // "Sep" — every other month matches. Normalise so the computed expectation
    // matches the UI regardless of which month the renewal lands in.
    const expectedRenewed = new Date(renewalPeriodEndSec * 1000)
      .toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
      .replace(/\bSept\b/, 'Sep');

    await gotoSurface(page, `/dashboard/customers/${lead.id}`);
    await page.getByRole('tab', { name: 'Memberships' }).click();
    await expect(page.getByText(planName)).toBeVisible({ timeout: 15_000 });
    // "Valid until" advanced to the renewed period end — assert IN THE UI.
    await expect(validUntilValue()).toHaveText(expectedRenewed, {
      timeout: 15_000,
    });
    expect(
      expectedRenewed,
      'renewed "Valid until" differs from the initial one'
    ).not.toBe(initialValidUntil);

    // --- 6. Cancel THROUGH THE UI (an affordance exists — no injection) --------
    await page
      .getByRole('button', { name: 'Cancel membership' })
      .click({ timeout: 15_000 });
    const cancelDialog = page.getByRole('alertdialog');
    // The shared ConfirmDeleteDialog titles this with the PLAN's own name —
    // `Cancel “<plan>” for this client?` (client-memberships-tab.tsx:93) — not
    // a fixed sentence. Asserting the plan proves the confirm opened for THIS
    // membership rather than another card on the tab, and survives rewording.
    await expect(cancelDialog).toBeVisible({ timeout: 15_000 });
    await expect(cancelDialog).toContainText(planName, { timeout: 15_000 });
    // The AlertDialog's confirm action (distinct from the "Keep membership"
    // cancel and from the card's trigger of the same label).
    await cancelDialog
      .getByRole('button', { name: 'Cancel membership' })
      .click();
    await expect(cancelDialog).toBeHidden({ timeout: 15_000 });

    // The card's status Badge flips to "Cancelled" (invalidation refetches the
    // client memberships in place).
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
});
