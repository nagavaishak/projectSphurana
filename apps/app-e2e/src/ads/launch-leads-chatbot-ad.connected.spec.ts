import { expect, test } from '@playwright/test';
import {
  E2E_CHATBOT_CAMPAIGN_NAME,
  SeedHelper,
  type SeededCampaign,
  clickThroughClaire,
  skipIfMetaRateLimited,
  skipIfMetaTransientAdFailure,
  skipIfMetaUnavailable,
} from '../fixtures/index.js';

/**
 * Launch Leads-Objective Chatbot Ad — Connected Org
 *
 * Verifies that chatbot ads work with the OUTCOME_LEADS campaign objective.
 * This was broken when a multi-destination asset_feed_spec was incorrectly
 * added for MESSENGER-only (leads) campaigns: the publish failed with
 * "The campaign destination type must be consistent with app destination in
 * call to action". The whole point of the spec is to publish a real ad under
 * that exact campaign shape and prove the error does not come back.
 *
 * Preconditions are SEEDED, never probed-and-skipped:
 *   - `seed.ensureCampaign()` creates the OUTCOME_LEADS + followUpType=chatbot
 *     campaign named `E2E_CHATBOT_CAMPAIGN_NAME` (with a daily budget, so the
 *     NoBudgetDialog never fires). If it is still missing afterwards we FAIL —
 *     that means the Meta Marketing API rejected the create, which is exactly
 *     the kind of regression a skip used to hide.
 *   - `seed.ensureTaggedVideoAsset()` guarantees a selectable uploaded video.
 *   - a service is guaranteed (the details step requires one).
 *
 * The only sanctioned escape hatch is `skipIfMetaRateLimited()` — Meta
 * throttling the shared ad account is a genuine external constraint.
 *
 * Wizard shape (apps/app desktop — see ads/new/config/-steps.ts):
 *   campaign → details (ad name + service + page) → select-media → customize.
 * There is no separate services / placement / page step: placement defaults to
 * Facebook and the follow-up type is inherited from the campaign.
 *
 * Auth: connected-user (setup-connected) — applied automatically by the
 * `connected-ads` Playwright project.
 *
 * Timeout: 10 min (Meta processing).
 */

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Seed the leads-objective chatbot campaign and return it.
 *
 * `ensureCampaign()` already guarantees a campaign the wizard can drive —
 * chatbot follow-up AND a local config row, which is the pair the campaign
 * step filters on. Re-finding it here by name would re-introduce the bug that
 * helper exists to close: on the shared test ad account a name can belong to
 * another stack's campaign, invisible to this org's wizard.
 *
 * Hard-fails (never skips) when the campaign is absent after seeding: a missing
 * campaign at this point is a real failure of the campaign-create path, not an
 * environmental condition.
 */
async function seedLeadsChatbotCampaign(
  seed: SeedHelper
): Promise<SeededCampaign> {
  const campaign = await seed.ensureCampaign();

  // The wizard picks the campaign by name, so a rename in ensureCampaign that
  // this spec did not follow must fail here, not in a locator timeout.
  expect(
    campaign.name.trim().toLowerCase(),
    'ensureCampaign() seeded a campaign under an unexpected name'
  ).toBe(E2E_CHATBOT_CAMPAIGN_NAME.toLowerCase());

  return campaign;
}

/** The details step requires exactly one service — guarantee one exists. */
async function ensureService(seed: SeedHelper): Promise<void> {
  const services = await seed.listServices();
  if (services.length > 0) return;

  await seed.createService({
    name: 'E2E Leads Chatbot Service',
    category: 'treatment',
    appointmentDuration: 30,
    priceText: '€50 per session',
    priceCents: 5000,
  });
}

/** Delete the ad we just published. Throws if it cannot be found. */
async function deleteAdByName(
  seed: SeedHelper,
  campaignId: string,
  adName: string
): Promise<void> {
  const ads = await seed.listAds(campaignId);
  const ad = ads.find((a) => a.name === adName);
  if (!ad) {
    throw new Error(
      `Published ad "${adName}" was not found under campaign ${campaignId} — cannot clean it up. ` +
        `Ads seen: ${ads.map((a) => a.name).join(', ') || '(none)'}`
    );
  }
  await seed.deleteAd(ad.id);
}

test.describe('Advertising — Launch Leads Chatbot Ad', () => {
  test.setTimeout(600_000);

  let campaign: SeededCampaign;

  test.beforeEach(async ({ page, request }) => {
    const seed = new SeedHelper(page, request);
    campaign = await seedLeadsChatbotCampaign(seed);
    await ensureService(seed);
    await seed.ensureTaggedVideoAsset();
  });

  test('launches a chatbot ad with leads optimization', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    const adName = `E2E Leads Chatbot Ad ${Date.now()}`;

    await test.step('navigate to ad wizard', async () => {
      await page.goto('/ads/new');
      await expect(
        page.getByRole('heading', { name: 'Select a campaign' })
      ).toBeVisible({ timeout: 30_000 });
    });

    await test.step('campaign step — select the leads chatbot campaign', async () => {
      // Distinguish the three states this step can be in before asserting on
      // the select. The select renders ONLY when campaigns.length > 0, so a
      // failed campaigns request used to surface here as a bare locator
      // timeout — which reads as "slow UI" and sent a real investigation
      // chasing runner capacity. Say which of the three actually happened.
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
      await expect(campaignSelect).toBeVisible({ timeout: 15_000 });
      await campaignSelect.click();

      const targetOption = page.getByRole('option', {
        name: new RegExp(escapeRegExp(campaign.name), 'i'),
      });
      await expect(targetOption).toBeVisible({ timeout: 10_000 });
      await targetOption.click();

      // The campaign step renders the follow-up badge for the selected
      // campaign — this is what makes it a CHATBOT ad (leads objective is set
      // on the campaign itself, which the seed created as OUTCOME_LEADS).
      await expect(page.getByText('Chatbot', { exact: true })).toBeVisible({
        timeout: 10_000,
      });

      await clickThroughClaire(
        page,
        page.getByRole('button', { name: 'Continue' })
      );
    });

    await test.step('details step — ad name, service and Facebook page', async () => {
      await expect(
        page.getByRole('heading', { name: 'Ad details' })
      ).toBeVisible({ timeout: 15_000 });

      await page.getByLabel('Ad name').fill(adName);

      // Service: searchable combobox (seeded above, so an option is guaranteed).
      await page.getByRole('button', { name: /select a service/i }).click();
      const serviceOption = page.getByRole('option').first();
      await expect(serviceOption).toBeVisible({ timeout: 10_000 });
      await serviceOption.click();

      // The Facebook-Page list is Meta-backed: a Meta outage returns a non-JSON
      // "An error occurred" body, the dropdown stays empty, and the assertion
      // below would time out on a purely external condition. Preflight it and
      // skip cleanly instead — when Meta is healthy this is a no-op and the
      // page selection below is still fully asserted.
      await skipIfMetaUnavailable(page);

      // Facebook page: rendered as a list of buttons, each showing "ID: <pageId>".
      // A single page auto-selects; clicking it is idempotent either way.
      const pageButton = page
        .getByRole('button')
        .filter({ hasText: /ID:\s*\S+/ })
        .first();
      await expect(pageButton).toBeVisible({ timeout: 15_000 });
      await pageButton.click();

      await clickThroughClaire(
        page,
        page.getByRole('button', { name: 'Continue' })
      );
    });

    await test.step('select media step — pick the seeded uploaded video', async () => {
      await expect(
        page.getByRole('heading', { name: 'Select content for your ad' })
      ).toBeVisible({ timeout: 15_000 });

      // ensureTaggedVideoAsset() seeds an *uploaded* video asset, which lives
      // under the Video → Uploaded tab.
      await page.getByRole('tab', { name: 'Uploaded' }).click();

      const mediaCard = page
        .locator('[data-testid="uploaded-video-card"]')
        .first();
      await expect(mediaCard).toBeVisible({ timeout: 30_000 });
      await mediaCard.click();

      // Continue only enables once the wizard has a selected video.
      const continueBtn = page.getByRole('button', { name: 'Continue' });
      await expect(continueBtn).toBeEnabled({ timeout: 10_000 });
      await clickThroughClaire(page, continueBtn);
    });

    await test.step('customize step — wait for AI content', async () => {
      await expect(
        page.getByRole('heading', { name: 'Customize your ad' })
      ).toBeVisible({ timeout: 15_000 });

      // Every AI field overlays "Generating..." while the copy is generated.
      await expect(page.getByText('Generating...').first()).toBeHidden({
        timeout: 90_000,
      });

      const publishBtn = page.getByRole('button', { name: 'Publish' });
      await expect(publishBtn).toBeEnabled({ timeout: 15_000 });
      await publishBtn.click();
    });

    await test.step('confirm publish in modal', async () => {
      // Publish runs an account health check first ("Checking..."), then opens
      // the confirm modal. A *failing* health check opens the HealthCheckDialog
      // instead — that is a broken connected account, so we let this assertion
      // fail rather than clicking past it.
      const publishDialog = page
        .getByRole('dialog')
        .filter({ hasText: /publish ad/i });
      await expect(publishDialog).toBeVisible({ timeout: 60_000 });

      await publishDialog.getByRole('button', { name: 'Publish' }).click();
      await expect(publishDialog).toBeHidden({ timeout: 60_000 });
    });

    // A throttled publish surfaces Meta's "Too Many Requests" dialog instead
    // of completing — skip cleanly rather than failing on the missing redirect.
    await skipIfMetaRateLimited(page);

    await test.step('verify ad published without destination type error', async () => {
      // The regression this spec exists for: the old bug surfaced as
      // "Failed to finalize ad: The campaign destination type must be
      //  consistent with app destination in call to action".
      await seed.assertNoError('publish leads chatbot ad');

      await page.waitForURL(/advertising/, { timeout: 30_000 });
    });

    await test.step('verify ad active on Meta, then delete', async () => {
      // Throws on timeout or a terminal (error/disapproved) Meta status.
      try {
        const { adStatus } = await seed.waitForAdActive(
          campaign.id,
          adName,
          300_000
        );
        expect(adStatus.toLowerCase()).toBe('active');
      } catch (error) {
        skipIfMetaTransientAdFailure(error);
      }

      await deleteAdByName(seed, campaign.id, adName);
    });
  });
});
