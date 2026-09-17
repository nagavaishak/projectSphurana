import { type Locator, type Page, expect, test } from '@playwright/test';
import {
  SeedHelper,
  branchUrl,
  clickThroughClaire,
  skipIfMetaRateLimited,
  skipIfMetaTransientAdFailure,
  skipIfMetaUnavailable,
} from '../fixtures/index.js';

/**
 * Edit Ad — Connected Org
 *
 * Full flow: create ad via wizard → publish → edit via dialog → verify changes
 * persist (after a reload, i.e. from the API, not React Query cache) → cleanup.
 *
 * Preconditions are SEEDED, never observed: `seedAdPrerequisites` guarantees a
 * chatbot campaign, a bookable service and ready media exist before the wizard
 * opens. If seeding cannot produce them the test fails loudly — it never skips
 * on app state, which would turn the feature's likeliest regression green.
 *
 * Auth: connected-user (setup-connected) — applied automatically by the
 * `connected-ads` Playwright project.
 *
 * Timeout: 10 min (wizard + Meta processing + edit)
 */

/**
 * Guarantee every precondition the ad wizard needs, then resolve the campaign
 * the test will drive. Lives outside the test body: setup may branch (seed only
 * what's missing); the test itself must not.
 *
 * Throws — never skips — when a precondition cannot be seeded.
 */
async function seedAdPrerequisites(
  seed: SeedHelper
): Promise<{ campaignId: string; campaignName: string }> {
  // Media: a ready "generated" video (default tab of the select-media step)
  // plus a tagged uploaded asset, so the step always has a selectable card.
  await seed.ensureCreatedVideo();
  await seed.ensureTaggedVideoAsset();

  // Service: the details step requires exactly one, and blocks Continue without it.
  const services = await seed.listServices();
  if (services.length === 0) {
    await seed.createService({
      name: 'E2E Ad Service',
      appointmentDuration: 60,
      priceText: '€50 per session',
      priceCents: 5000,
    });
  }

  // Campaign: chatbot follow-up + a daily budget (a budget-less campaign can
  // never publish — the wizard hard-stops on the "Budget Required" dialog).
  //
  // Take what ensureCampaign() returns rather than re-finding one by name: the
  // campaign list is Meta's, over an ad account every stack shares, so a
  // matching name can belong to a campaign with no local config — which the
  // wizard's campaign step filters out and renders as "no campaigns".
  const campaign = await seed.ensureCampaign();

  return { campaignId: campaign.id, campaignName: campaign.name };
}

/** The ads-table row for a given ad name. */
function adRow(page: Page, adName: string): Locator {
  return page
    .locator('table tbody tr, [role="row"]')
    .filter({ hasText: adName })
    .first();
}

/**
 * Open the ad's Edit dialog from its row actions menu. Outside the test body so
 * both the edit and the post-reload verification can reuse it verbatim.
 */
async function openEditDialog(page: Page, adName: string): Promise<Locator> {
  const row = adRow(page, adName);
  await expect(row).toBeVisible({ timeout: 30_000 });

  // Open the row menu and pick Edit — as ONE retryable unit.
  //
  // The first render of the ads table is not its last: the row paints, the ads
  // query then settles, and React remounts the rows. A dropdown opened in that
  // window is torn down with them, so `Edit` was found, clicked, and reported
  // "element was detached from the DOM" over and over until the click timed out
  // — 30 seconds spent losing a race against a single re-render. Retrying the
  // OPEN as well as the click rides that out, where retrying only the click
  // never can: once the menu is gone, no amount of re-clicking a dead menu item
  // brings it back.
  await expect(async () => {
    await row.getByRole('button').last().click();
    await page
      .getByRole('menuitem', { name: /^edit$/i })
      .click({ timeout: 5_000 });
    await expect(page.getByLabel('Ad name')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  // Identify the editor by WHAT IT IS, not by copy it never carries. The Edit
  // action opens the ad-detail side panel, whose header is the AD NAME — the
  // string "edit ad" appears nowhere in it, so `hasText: /edit ad/i` could never
  // match and the panel was declared missing while sitting right there on screen.
  // Its "Ad name" field is the thing that makes it the ad editor.
  //
  // And it is not a dialog: the panel renders as an `<aside>` (role
  // `complementary`) docked beside the table, not as a modal — so
  // `getByRole('dialog')` matched nothing while the editor sat open on screen,
  // fully populated, in the failure snapshot. Accept EITHER role and let the
  // "Ad name" field do the identifying, so a future change from aside to modal
  // (or back) doesn't break this again.
  const dialog = page
    .getByRole('dialog')
    .or(page.getByRole('complementary'))
    .filter({ has: page.getByLabel('Ad name') });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

/**
 * Drive the publish confirmation. The wizard runs an async Meta account health
 * check first ("Checking..." on the Publish button) and then shows exactly one
 * of: the publish modal (healthy), the health-check dialog (hard fail — it has
 * no proceed button, publishing is genuinely blocked), or the budget dialog.
 * The last two are real, actionable failures, so they throw with the reason.
 */
async function confirmPublish(page: Page): Promise<void> {
  await expect(page.getByText('Checking...')).toBeHidden({ timeout: 30_000 });

  const publishDialog = page
    .getByRole('dialog')
    .filter({ hasText: /publish ad/i });
  const healthDialog = page.getByRole('dialog').filter({
    hasText: /meta account needs attention|review before publishing/i,
  });
  const budgetDialog = page
    .getByRole('dialog')
    .filter({ hasText: /budget required/i });

  await expect(
    publishDialog.or(healthDialog).or(budgetDialog).first()
  ).toBeVisible({ timeout: 45_000 });

  if ((await healthDialog.count()) > 0) {
    const detail = await healthDialog.textContent();
    throw new Error(
      `[publish] Meta account health check failed — the wizard blocks publishing: ${detail?.slice(0, 300)}`
    );
  }
  if ((await budgetDialog.count()) > 0) {
    throw new Error(
      '[publish] Campaign has no budget — cannot publish. The seeded campaign must carry a dailyBudget.'
    );
  }

  const confirmBtn = publishDialog.getByRole('button', { name: /^publish$/i });
  await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
  // force: the dialog re-renders into its "Publishing..." state as the click
  // lands, and a plain click races the detach.
  await confirmBtn.click({ force: true });

  await expect(publishDialog).toBeHidden({ timeout: 60_000 });
}

test.describe('Advertising — Edit Ad', () => {
  test.setTimeout(600_000);

  test('creates an ad, edits it, and verifies changes persist', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    const adName = `E2E Edit Test ${Date.now()}`;
    const updatedHeadline = `E2E Updated ${Date.now()}`;
    let campaignId = '';
    let campaignName = '';
    let adId = '';

    await test.step('seed wizard preconditions (campaign, service, media)', async () => {
      const seeded = await seedAdPrerequisites(seed);
      campaignId = seeded.campaignId;
      campaignName = seeded.campaignName;
      expect(campaignId, 'seeded campaign id').toBeTruthy();
      expect(campaignName, 'seeded campaign name').toBeTruthy();
    });

    // ─── Create Ad via Wizard ────────────────────────────────────

    await test.step('campaign step — select the seeded chatbot campaign', async () => {
      await page.goto('/ads/new');

      await expect(
        page.getByRole('heading', { name: /select a campaign/i })
      ).toBeVisible({ timeout: 30_000 });

      const campaignSelect = page.getByRole('combobox').first();
      await campaignSelect.click();

      // Deterministic: pick the campaign we seeded, by name — no hunting.
      await page
        .getByRole('option')
        .filter({ hasText: campaignName })
        .first()
        .click();

      // ensureCampaign() seeds followUpType 'chatbot'; only chatbot campaigns
      // support ad launch, so this badge is a precondition, not an observation.
      await expect(page.getByText('Chatbot', { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      await clickThroughClaire(
        page,
        page.getByRole('button', { name: /^continue$/i })
      );
    });

    await test.step('details step — name, service, page', async () => {
      await expect(
        page.getByRole('heading', { name: /ad details/i })
      ).toBeVisible({ timeout: 15_000 });

      await page.getByLabel(/ad name/i).fill(adName);

      const servicePicker = page.getByRole('button', {
        name: /select a service/i,
      });
      await expect(servicePicker).toBeVisible({ timeout: 15_000 });
      await servicePicker.click();
      await page.getByRole('option').first().click();
      // The trigger's label flips to the chosen service — proves the pick stuck.
      await expect(
        page.getByRole('button', { name: /select a service/i })
      ).toHaveCount(0);

      // The Facebook-Page list is Meta-backed: a Meta outage returns a non-JSON
      // "An error occurred" body, the dropdown stays empty, and the assertion
      // below would time out on a purely external condition. Preflight it and
      // skip cleanly instead — when Meta is healthy this is a no-op and the
      // page selection below is still fully asserted.
      await skipIfMetaUnavailable(page);

      // Facebook Page: auto-selected when the org has exactly one; clicking is
      // idempotent, so this covers both cases without branching.
      const pageOption = page
        .locator('button')
        .filter({ hasText: /ID:\s/ })
        .first();
      await expect(pageOption).toBeVisible({ timeout: 15_000 });
      await pageOption.click();

      await clickThroughClaire(
        page,
        page.getByRole('button', { name: /^continue$/i })
      );
    });

    await test.step('select media step', async () => {
      await expect(
        page.getByRole('heading', { name: /select content for your ad/i })
      ).toBeVisible({ timeout: 15_000 });

      const mediaCard = page
        .locator(
          '[data-testid="video-card"], [data-testid="uploaded-video-card"], [data-testid="image-card"], [data-testid="graphic-card"]'
        )
        .first();
      await expect(
        mediaCard,
        'No media card rendered — the seeded ready video should surface in the wizard media step'
      ).toBeVisible({ timeout: 30_000 });
      await mediaCard.click();

      // Continue only enables once a video is selected — proves the click stuck.
      const continueBtn = page.getByRole('button', { name: /^continue$/i });
      await expect(continueBtn).toBeEnabled({ timeout: 10_000 });
      await clickThroughClaire(page, continueBtn);
    });

    await test.step('customize step — wait for AI content, then publish', async () => {
      await expect(
        page.getByRole('heading', { name: /customize your ad/i })
      ).toBeVisible({ timeout: 15_000 });

      // The copy fields stream in from the model; the Publish button reads
      // "Generating..." until they land.
      await expect(page.getByText('Generating...').first()).toBeHidden({
        timeout: 60_000,
      });

      const publishBtn = page.getByRole('button', { name: /^publish$/i });
      await expect(publishBtn).toBeEnabled({ timeout: 30_000 });
      await publishBtn.click();
    });

    await test.step('confirm publish', async () => {
      await confirmPublish(page);
    });

    // A throttled publish surfaces Meta's "Too Many Requests" dialog instead
    // of completing — a genuine external constraint, the one sanctioned skip.
    await skipIfMetaRateLimited(page);

    await test.step('verify ad published and resolve its id', async () => {
      await seed.assertNoError('publish ad for edit test');

      // The API is the source of truth for what was just created.
      await expect
        .poll(async () => (await seed.listAds(campaignId)).map((a) => a.name), {
          message: `published ad "${adName}" never appeared under campaign ${campaignId}`,
          timeout: 60_000,
          intervals: [2_000, 3_000, 5_000, 10_000],
        })
        .toContain(adName);

      const ads = await seed.listAds(campaignId);
      adId = ads.find((a) => a.name === adName)?.id ?? '';
      expect(adId, `could not resolve the id of ad "${adName}"`).toBeTruthy();
    });

    // ─── Edit Ad via Dialog ──────────────────────────────────────

    await test.step('open the published campaign ads table', async () => {
      // The API poll above established that this specific ad exists. Navigate
      // directly to its owning campaign rather than treating wizard redirect
      // timing as evidence of successful publication.
      await page.goto(
        await branchUrl(page, `/dashboard/marketing/advertising/${campaignId}`)
      );
      await expect(adRow(page, adName)).toBeVisible({ timeout: 30_000 });
    });

    await test.step('edit the headline and save', async () => {
      const dialog = await openEditDialog(page, adName);

      const headlineInput = dialog.getByLabel(/headline/i);
      await headlineInput.clear();
      await headlineInput.fill(updatedHeadline);

      await dialog.getByRole('button', { name: /save changes/i }).click();

      // This ad was PUBLISHED two steps ago, so saving copy on it replaces the
      // creative on Meta and sends the ad back through review. The panel now
      // makes the owner agree to that before it writes, so the flow this test
      // drives has one more step than it used to. Asserted, not clicked past:
      // if the confirm ever stops appearing on a live ad, the owner is back to
      // having delivery paused with no warning, and this is where that shows up.
      const reviewConfirm = page
        .getByRole('alertdialog')
        .filter({ hasText: /send it back for review/i });
      await expect(reviewConfirm).toBeVisible({ timeout: 15_000 });
      await reviewConfirm
        .getByRole('button', { name: /replace and send for review/i })
        .click();

      // Dialog closes only on API success.
      await expect(dialog).toBeHidden({ timeout: 60_000 });
      await seed.assertNoError('edit ad save');
    });

    await test.step('reload and verify the headline persisted', async () => {
      // Reload so the value comes from the API, not React Query's cache — this
      // is the assertion the whole test exists for.
      await page.reload();
      await page
        .locator('[data-sidebar="menu-button"]')
        .last()
        .waitFor({ timeout: 30_000 });

      const dialog = await openEditDialog(page, adName);

      await expect(dialog.getByLabel(/headline/i)).toHaveValue(
        updatedHeadline,
        {
          timeout: 10_000,
        }
      );

      await dialog.getByRole('button', { name: /cancel/i }).click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });
    });

    // ─── Cleanup ─────────────────────────────────────────────────

    await test.step('wait for Meta to activate the ad, then delete it', async () => {
      // Status-aware poll instead of a blind sleep: it also catches a Meta
      // rejection of the ad we just published. Delete regardless so a failure
      // here never leaks a live ad into the connected org.
      try {
        await seed.waitForAdActive(campaignId, adName, 240_000);
      } catch (error) {
        // Meta's own transient wobble lands on the ad row as a terminal error;
        // external, not a regression. Anything else re-throws. See meta.fixture.ts.
        skipIfMetaTransientAdFailure(error);
      } finally {
        await seed.deleteAd(adId);
      }
    });
  });
});
