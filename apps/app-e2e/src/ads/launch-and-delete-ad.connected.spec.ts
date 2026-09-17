import { type Page, expect, test } from '@playwright/test';
import {
  SeedHelper,
  clickThroughClaire,
  skipIfMetaRateLimited,
  skipIfMetaTransientAdFailure,
  skipIfMetaUnavailable,
} from '../fixtures/index.js';

/**
 * Launch & Delete Ad — Connected Org
 *
 * Full ad lifecycle: create ad via wizard → publish → poll Meta until the ad is
 * ACTIVE → delete it.
 *
 * Preconditions are SEEDED, never observed: `seedAdPrerequisites` guarantees a
 * chatbot campaign (with a budget), a bookable service and ready media exist
 * before the wizard opens. If one cannot be seeded the test fails loudly — it
 * never skips on app state.
 *
 * The published ad is resolved from the API by its unique name (`seed.listAds`),
 * NOT from a `[data-ad-id]` attribute — no such attribute exists in the app, so
 * the old lookup silently yielded null and the ad was never deleted.
 *
 * Auth: connected-user (setup-connected) — applied automatically by the
 * `connected-ads` Playwright project.
 *
 * Timeout: 10 min (Meta processing + activation poll before delete)
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

test.describe('Advertising — Launch & Delete Ad', () => {
  test.setTimeout(600_000);

  test('launches an ad and deletes it', async ({ page, request }) => {
    const seed = new SeedHelper(page, request);
    const adName = `E2E Test Ad ${Date.now()}`;
    let campaignId = '';
    let campaignName = '';
    let adId = '';

    await test.step('seed wizard preconditions (campaign, service, media)', async () => {
      const seeded = await seedAdPrerequisites(seed);
      campaignId = seeded.campaignId;
      campaignName = seeded.campaignName;
      expect(campaignId, 'seeded campaign id').toBeTruthy();
    });

    await test.step('campaign step — select the seeded chatbot campaign', async () => {
      await page.goto('/ads/new');

      await expect(
        page.getByRole('heading', { name: /select a campaign/i })
      ).toBeVisible({ timeout: 30_000 });

      // Same three-way check as launch-leads-chatbot-ad: the combobox only
      // exists when campaigns.length > 0, so clicking it blind turns "the
      // campaigns request failed" into a 30s click timeout that reads as a
      // slow runner. Name the actual state instead.
      const campaignSelect = page.locator(
        '[data-claire-target="ads-new-campaign-select"]'
      );
      const loadError = page.locator(
        '[data-claire-target="ads-new-campaign-error"]'
      );
      await expect
        .poll(
          async () =>
            (await campaignSelect.count()) > 0
              ? 'select'
              : (await loadError.count()) > 0
                ? 'error'
                : 'empty',
          {
            timeout: 15_000,
            message:
              'campaign step never rendered a campaign select: "error" = the campaigns request failed, "empty" = the org genuinely has none (the seeded campaign went missing)',
          }
        )
        .toBe('select');
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
      // "Generating..." until they land. `customize` is the LAST step — there
      // are no further Continue clicks.
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
      await seed.assertNoError('publish ad');

      await page.waitForURL(/advertising/, { timeout: 30_000 });

      // The API is the source of truth — and the only way to get the ad id
      // (the ads table renders no `data-ad-id`).
      await expect
        .poll(async () => (await seed.listAds(campaignId)).map((a) => a.name), {
          message: `published ad "${adName}" never appeared under campaign "${campaignName}" (${campaignId})`,
          timeout: 60_000,
          intervals: [2_000, 3_000, 5_000, 10_000],
        })
        .toContain(adName);

      const ads = await seed.listAds(campaignId);
      adId = ads.find((a) => a.name === adName)?.id ?? '';
      expect(adId, `could not resolve the id of ad "${adName}"`).toBeTruthy();
    });

    await test.step('wait for Meta to activate the ad, then delete it', async () => {
      // Status-aware poll instead of a blind soak: it also catches a Meta
      // rejection of the ad we just published. Delete regardless so a failure
      // here never leaks a live ad into the connected org.
      try {
        await seed.waitForAdActive(campaignId, adName, 300_000);
      } catch (error) {
        // Meta's own transient wobble lands on the ad row as a terminal error;
        // external, not a regression. Anything else re-throws. See meta.fixture.ts.
        skipIfMetaTransientAdFailure(error);
      } finally {
        await seed.deleteAd(adId);
      }
    });

    await test.step('verify the ad is gone', async () => {
      await expect
        .poll(async () => (await seed.listAds(campaignId)).map((a) => a.name), {
          message: `ad "${adName}" still listed after DELETE /meta-ads/${adId}`,
          timeout: 30_000,
          intervals: [2_000, 3_000, 5_000],
        })
        .not.toContain(adName);
    });
  });
});
