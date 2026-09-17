import { type Locator, type Page, expect, test } from '@playwright/test';
import { SeedHelper } from '../fixtures/index.js';

/**
 * Create Campaign — Connected Org
 *
 * Creates a real Meta campaign via the advertising dashboard for each
 * chatbot messaging destination (Messenger, Instagram DM, WhatsApp),
 * then cleans up via API.
 *
 * Destination selection lives on the CAMPAIGN creative screen (not the ad),
 * so these variants are the primary coverage for the destination-per-campaign
 * flow. Full ad-launch coverage stays in launch-and-delete-ad.connected.spec.ts.
 *
 * Auth: connected-user (setup-connected) — applied automatically by the
 * `connected-ads` Playwright project. setup-connected seeds the Meta Ads
 * integration and (when TEST_WHATSAPP_* is configured) the WhatsApp account,
 * so "Meta Ads not connected" and "WhatsApp not connected" are NOT runtime
 * observations to skip on:
 *
 *   - Meta Ads missing  → hard failure (the connected setup is broken).
 *   - Instagram DM disabled → hard failure (the connected Page must have a
 *     linked Instagram Professional account; losing it is a real regression).
 *   - WhatsApp creds absent → declared ENVIRONMENT skip, decided from
 *     process.env before the browser opens.
 *
 * Note (apps/app vs apps/web): apps/app's create-campaign modal uses
 *   - a Dialog (not a Sheet)
 *   - a RadioGroup (cards labeled "Leads should fill out a form" /
 *     "Leads should message us") for follow-up type — not a button
 *     labeled "Chatbot"
 *   - Checkboxes (id `${formId}-${destination}`) inside a Field with
 *     `data-disabled` — not buttons
 *   - Submit button is labeled "Create campaign"
 *
 * Timeout: 10 min (Meta API can be slow)
 */

type Destination = 'messenger' | 'instagram_dm' | 'whatsapp';

const DESTINATION_LABELS: Record<Destination, RegExp> = {
  messenger: /^Messenger$/i,
  instagram_dm: /^Instagram DM$/i,
  whatsapp: /^WhatsApp$/i,
};

/**
 * WhatsApp can only be seeded (and therefore selected) when the WhatsApp
 * Business system-user credentials are present in this environment. Decided up
 * front from env — never from what the dialog rendered.
 */
const HAS_WHATSAPP_CREDS = Boolean(
  process.env.TEST_WHATSAPP_ACCESS_TOKEN &&
    process.env.TEST_WHATSAPP_PHONE_NUMBER_ID &&
    process.env.TEST_WHATSAPP_WABA_ID &&
    process.env.TEST_WHATSAPP_PHONE_NUMBER
);

test.describe('Advertising — Create Campaign (chatbot destinations)', () => {
  test.setTimeout(600_000);

  for (const destination of [
    'messenger',
    'instagram_dm',
    'whatsapp',
  ] as const) {
    // Evaluated at collection time, outside the test body: an environment gate,
    // not an observation of the app.
    const missingWhatsAppCreds =
      destination === 'whatsapp' && !HAS_WHATSAPP_CREDS;

    // De-quarantined: the geocode-step failure was the SPEC's keyboard
    // selection, not the app. See the note in `fillCampaignLocation` — it now
    // clicks the prediction, which is the interaction Google's legacy widget
    // actually honours.
    //
    // The old note's read ("the preview lane passes it vacuously — its org has
    // a location, so `if (isPrefilled) return;` skips the subject") still
    // holds and is worth keeping: whether this step is exercised at all
    // depends on whether the org already has a geocoded location.
    test(`creates a chatbot campaign with ${destination} destination and cleans up`, async ({
      page,
      request,
    }) => {
      test.skip(
        missingWhatsAppCreds,
        'TEST_WHATSAPP_* not configured in this environment — the WhatsApp account cannot be seeded'
      );

      // DIAGNOSTIC — Google names its own failures; we were inferring them.
      //
      // When the Places request is rejected, Google does not throw: it swaps the
      // input's placeholder for "Oops! Something went wrong.", disables it, and
      // logs the reason to the CONSOLE. From the test's side that looks like
      // `.pac-container .pac-item` never appearing — a timing bug, which it is
      // not. Three hypotheses (referrer, wrong key, wrong project) were argued
      // from a missing locator before anyone read the console message that says
      // exactly which one it is: RefererNotAllowedMapError,
      // ApiNotActivatedMapError, ApiTargetBlockedMapError, InvalidKeyMapError,
      // BillingNotEnabledMapError.
      //
      // Worth keeping even though none of those was the cause here: an isolated
      // repro against the same key rendered four predictions for "Dublin", so
      // the key/referrer/billing were never the problem. This listener is how
      // we would know that immediately next time. It also surfaces Google's
      // standing deprecation warning — `google.maps.places.Autocomplete` is
      // closed to new customers as of 2025-03-01 in favour of
      // `PlaceAutocompleteElement`; we are grandfathered, not exempt.
      page.on('console', (msg) => {
        const t = msg.text();
        if (/google|maps|places|api|referer|referrer|denied|billing/i.test(t)) {
          console.log(`[maps-console:${msg.type()}] ${t}`);
        }
      });
      page.on('pageerror', (err) =>
        console.log(`[maps-pageerror] ${err.message}`)
      );
      page.on('requestfailed', (req) => {
        if (/googleapis|gstatic/i.test(req.url())) {
          console.log(
            `[maps-requestfailed] ${req.url().split('?')[0]} — ${req.failure()?.errorText}`
          );
        }
      });
      page.on('response', async (res) => {
        if (/maps\.googleapis\.com/i.test(res.url()) && res.status() >= 400) {
          console.log(`[maps-http] ${res.status()} ${res.url().split('?')[0]}`);
        }
      });

      const seed = new SeedHelper(page, request);
      const campaignName = `E2E Campaign ${destination} ${Date.now()}`;

      try {
        await test.step('seed the WhatsApp connection', async () => {
          // Idempotent; setup-connected already ran it, but re-seeding here
          // makes the precondition explicit and survives a wiped account row.
          await seedWhatsAppIfTargeted(seed, destination);
        });

        await test.step('navigate to advertising', async () => {
          await seed.gotoDashboardPage('/dashboard/marketing/advertising');
        });

        await test.step('open new campaign dialog', async () => {
          await openNewCampaignDialog(page);
        });

        await test.step('select chatbot follow-up type', async () => {
          await selectChatbotFollowUp(page);
        });

        await test.step('select destination', async () => {
          await selectDestination(page, destination);
        });

        await test.step('fill campaign form', async () => {
          await fillCampaignForm(page, { name: campaignName });
        });

        await test.step('submit campaign', async () => {
          await submitCampaign(page);
        });

        await test.step('verify campaign created', async () => {
          await seed.assertNoError('create campaign');

          // After submit, the modal closes and we either navigate to the
          // campaign detail page or stay on the list with a toast.
          await expect(
            page
              .getByText(campaignName)
              .or(page.getByText(/created|success/i))
              .first()
          ).toBeVisible({ timeout: 30000 });

          // The modal's success state confirms its mutation completed, but
          // the campaign list can briefly lag behind that write. Poll the API
          // source of truth instead of treating the first read as definitive.
          await expect
            .poll(async () => (await seed.listCampaigns()).map((c) => c.name), {
              message: `campaign "${campaignName}" persisted via the API`,
              timeout: 60_000,
              intervals: [2_000, 3_000, 5_000, 10_000],
            })
            .toContain(campaignName);
        });
      } finally {
        // Best-effort teardown — runs even when a step above failed, so a
        // half-created Meta campaign is never orphaned.
        await deleteCampaignByName(seed, campaignName);
      }
    });
  }
});

// ── Module-scope helpers ───────────────────────────────────────────────────
// Branching lives here, outside the test body: the test itself has one path.

async function seedWhatsAppIfTargeted(
  seed: SeedHelper,
  destination: Destination
): Promise<void> {
  if (destination !== 'whatsapp') return;

  const seeded = await seed.seedConnectedWhatsAppAccount();
  if (!seeded) {
    throw new Error(
      'WhatsApp seed reported no-op despite TEST_WHATSAPP_* being set — the WhatsApp destination cannot be exercised'
    );
  }
}

/**
 * Open the create-campaign dialog. When Meta isn't connected the advertising
 * layout renders a full-page "Connect Meta Ads" empty state instead of the
 * campaign list — that is a broken connected-org setup, so fail loudly rather
 * than skip (a skip here would hide every campaign regression).
 */
async function openNewCampaignDialog(page: Page): Promise<void> {
  const newCampaignBtn = page
    .locator('main')
    .getByRole('button', { name: /new campaign/i });

  await expect(
    newCampaignBtn,
    'Meta Ads must be connected on the connected org (setup-connected seeds it) — a "Connect Meta Ads" empty state here means the integration was lost'
  ).toBeVisible({ timeout: 30000 });

  await newCampaignBtn.click();
}

async function selectChatbotFollowUp(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"]').first();
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  // Follow-up is a RadioGroup with cards. The chatbot card is labeled
  // "Leads should message us".
  const chatbotCard = dialog.getByText(/leads should message us/i);
  await chatbotCard.waitFor({ state: 'visible', timeout: 5000 });
  await chatbotCard.click();
}

/**
 * The destination checkbox carries `id="${formId}-${destination}"`, and its
 * FieldLabel points at it via htmlFor.
 */
function destinationCheckbox(page: Page, destination: Destination): Locator {
  return page
    .locator('[role="dialog"]')
    .first()
    .locator(`[id$="-${destination}"]`);
}

async function selectDestination(
  page: Page,
  destination: Destination
): Promise<void> {
  const dialog = page.locator('[role="dialog"]').first();
  const messengerLabel = dialog.getByText(DESTINATION_LABELS.messenger).first();
  const targetLabel = dialog.getByText(DESTINATION_LABELS[destination]).first();

  await targetLabel.waitFor({ state: 'visible', timeout: 5000 });

  const targetCheckbox = destinationCheckbox(page, destination);

  // A disabled checkbox means the underlying integration is missing on the
  // connected org (no WhatsApp account / no linked Instagram Professional
  // account). Both are seeded/expected preconditions — assert, never skip.
  await expect(
    targetCheckbox,
    `${destination} destination must be available on the connected org (a disabled checkbox means its integration is missing)`
  ).toBeEnabled({ timeout: 10000 });

  // Chatbot defaults to messenger. If the target is messenger, leave it
  // selected. Otherwise select the target FIRST, and only then deselect
  // messenger.
  //
  // The order is load-bearing, not cosmetic: a chatbot campaign must keep at
  // least one destination, and the form enforces it (use-create-campaign-form
  // re-sets `['messenger']` the moment `destinations` goes empty). Deselecting
  // messenger while it is the ONLY selection therefore snaps straight back to
  // checked — which is exactly what a user would see, and what this spec used
  // to trip over. Add, then remove: the set is never empty and the invariant
  // never fires.
  if (destination !== 'messenger') {
    await targetLabel.click();
    await expect(targetCheckbox).toBeChecked();

    await messengerLabel.click();
    await expect(destinationCheckbox(page, 'messenger')).not.toBeChecked();
  }

  await expect(targetCheckbox).toBeChecked();
}

async function fillCampaignForm(
  page: Page,
  opts: { name: string }
): Promise<void> {
  const dialog = page.locator('[role="dialog"]').first();

  // Campaign name
  const nameInput = dialog.getByLabel(/^name$/i);
  await expect(nameInput).toBeVisible({ timeout: 10000 });
  await nameInput.fill(opts.name);

  // Daily budget (required by the form schema — always rendered)
  const budgetInput = dialog.getByLabel(/daily budget/i);
  await expect(budgetInput).toBeVisible({ timeout: 10000 });
  await budgetInput.fill('1.00');

  await fillCampaignLocation(page, dialog);

  await expect(dialog.getByText(/radius/i)).toBeVisible({ timeout: 15000 });
}

/**
 * The form prefills from useListLocations() when the org has exactly one
 * geocoded location, swapping the CitySearch input for a "MapPin + name +
 * Remove" badge. Wait for whichever path appears, then only drive the Google
 * Maps autocomplete when no location is prefilled.
 */
async function fillCampaignLocation(
  page: Page,
  dialog: Locator
): Promise<void> {
  const removeLocationBtn = dialog.getByRole('button', {
    name: /remove location/i,
  });
  const locationInput = page.getByPlaceholder(/search for a city/i);

  const isPrefilled = await Promise.race([
    removeLocationBtn
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false),
    locationInput
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => false)
      .catch(() => false),
  ]);

  if (isPrefilled) return;

  await expect(locationInput).toBeVisible({ timeout: 5000 });
  await locationInput.click();
  await locationInput.type('Dublin', { delay: 100 });

  // Wait for Google's autocomplete predictions, then CLICK the first one.
  //
  // Do not reach for ArrowDown + Enter here. The legacy `pac` widget never
  // takes the keyboard selection under Playwright: `.pac-item-selected` stays
  // at count 0 after ArrowDown (via `locator.press` AND `page.keyboard.press`
  // alike), so Enter commits nothing, `place_changed` never fires, and the
  // badge below never appears. That is what quarantined this spec — and the
  // note on it blamed the product, naming `address-autocomplete.tsx` and a
  // missing `address_components`. Neither is involved: this input is
  // `components/app/city-search.tsx`, whose guard is `place.geometry`, and its
  // `types: ['geocode']` resolves "Dublin" correctly. Clicking the prediction
  // returns `{ formatted_address: 'Dublin, Ireland', geometry: {...} }`, so
  // the handler runs and the badge appears.
  // Scope to the LIVE dropdown, not merely the first one in the DOM.
  //
  // Google appends a `.pac-container` to <body> per Autocomplete instance and
  // never removes it, so a closed dialog leaves its dropdown behind. Selecting
  // `.pac-container .pac-item` across the whole page then resolves to a stale
  // container's row sitting underneath the live one, and the click fails with
  // "subtree intercepts pointer events" — which is exactly how the second
  // destination (instagram_dm) failed while the first (messenger) passed.
  //
  // city-search.tsx no longer rebuilds the widget on every render, so the
  // stack no longer grows without bound; this stays scoped anyway, because one
  // leftover container from a previous dialog is enough to reintroduce it.
  const pacContainer = page
    .locator('.pac-container')
    .filter({ has: page.locator('.pac-item') })
    .last();
  const pacItem = pacContainer.locator('.pac-item').first();
  await pacItem.waitFor({ state: 'visible', timeout: 10000 });
  await pacItem.click();

  // Geocoding resolves into the "Remove location" badge — the same state the
  // prefilled path lands in.
  await expect(removeLocationBtn).toBeVisible({ timeout: 20_000 });
}

async function submitCampaign(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"]').first();
  await dialog.getByRole('button', { name: /create campaign/i }).click();
}

/** Best-effort cleanup: delete the campaign if it made it to the API. */
async function deleteCampaignByName(
  seed: SeedHelper,
  campaignName: string
): Promise<void> {
  try {
    const campaigns = await seed.listCampaigns();
    const created = campaigns.find((c) => c.name === campaignName);
    if (created) {
      await seed.deleteCampaign(created.id);
    }
  } catch (err) {
    console.warn(
      `[create-campaign] failed to clean up campaign "${campaignName}":`,
      err
    );
  }
}
