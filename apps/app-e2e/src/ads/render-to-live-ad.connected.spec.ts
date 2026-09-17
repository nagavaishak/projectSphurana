import { type Page, expect, test } from '@playwright/test';
import {
  SeedHelper,
  type SeededCampaign,
  clickThroughClaire,
  isE2EChatbotCampaign,
  skipIfMetaRateLimited,
  skipIfMetaTransientAdFailure,
  skipIfMetaUnavailable,
} from '../fixtures/index.js';

/**
 * Video → Live Ad — Connected Org (the join, against a real Meta ad account).
 *
 * The two halves of the content→ad pipeline are otherwise tested in isolation:
 *
 *   - src/ads/launch-and-delete-ad.connected.spec.ts launches an ad to ACTIVE
 *     on Meta, but from a seeded *asset*, picking the `.first()` media card —
 *     it never visits the video-selection step.
 *   - src/real/create-video/create-video-dialog.spec.ts renders a video and
 *     throws it away.
 *
 * This spec is the seam between them. In the connected org it:
 *   1. Seeds a `ready` video (SeedHelper.ensureCreatedVideo) and a chatbot
 *      campaign. Never probes for either.
 *   2. Runs the ad wizard — campaign → details → select-media → customize —
 *      and at the media step selects the card by `[data-video-id="${videoId}"]`,
 *      NOT `.first()`, which is the whole point: the ad is launched against
 *      THAT specific video record.
 *   3. Drives the ad to ACTIVE on Meta (seed.waitForAdActive), resolving the
 *      published ad by name via the API (there is no `[data-ad-id]` seam).
 *   4. In a `finally`, tears down what it created (ad, campaign if this run
 *      created it, service), each delete in its own try/catch. The seeded
 *      video is a SHARED idempotent fixture — setup-connected, edit-ad,
 *      launch-and-delete-ad and video-playback all rely on it — so it is
 *      deliberately NOT deleted here.
 *
 * It no longer renders anything. It used to render a fresh video AND a fresh
 * graphic, which was 74% of the connected-ads suite for coverage that already
 * exists nightly in `real-e2e`; see the note at step 1 and ENG-803.
 *
 * Every precondition is SEEDED, so there is exactly one path through the test.
 * The only sanctioned skips are the Meta ones — external constraints.
 *
 * Auth: connected-user (setup-connected) — applied automatically by the
 * `connected-ads` Playwright project (serial, single-worker). The wizard's
 * video card exposes `data-video-id` (select-video-step.tsx) so the test can
 * address one specific video rather than guessing.
 *
 * Timeout: 5 min — Meta ad creation and activation is now the long pole.
 */

interface Teardown {
  serviceId: string | null;
  /** Only set when THIS run created the campaign. */
  campaignId: string | null;
  adId: string | null;
}

test.describe('Advertising — Render to Live Ad', () => {
  test.setTimeout(300_000);

  // De-quarantined. The symptom on file was real — the video never left
  // "draft" and the spec burned its full 8-minute waitForVideoReady — but the
  // cause named alongside it (an "enqueue/consume gap" at an idle worker) was
  // not: a queued render sets status='queued' first, so `draft` acquits the
  // worker and indicts the export call. The spec now waits on that call and
  // reports its rejection. See the note in the create step.
  test('launches a live ad from one specific seeded video', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);

    const ids: Teardown = {
      serviceId: null,
      campaignId: null,
      adId: null,
    };

    const runId = Date.now();
    const serviceName = `E2E Render-to-Ad Service ${runId}`;
    const adName = `E2E Render-to-Ad ${runId}`;

    try {
      // ── 0. Seed every precondition ─────────────────────────────────────
      // The wizard's details step needs a service. Seed our own so the
      // picker is deterministic.
      const service = await seed.createService({
        name: serviceName,
        category: 'treatment',
      });
      ids.serviceId = service.id;

      // Keep one tagged media item in the org so the wizard's select-media
      // step is never empty. (The raw-footage seed that used to sit here went
      // with the generation dialog — it existed only for that dialog's
      // "Choose your footage" step.)
      await seed.ensureTaggedVideoAsset();

      // ── 1. Point at a ready video (SEEDED, not rendered here) ───────────
      //
      // This used to render a fresh video through the Socials dialog and poll
      // it to `ready`, then render a fresh graphic and poll that too. Together
      // they were 3.9 minutes of a 5.3-minute suite — 74% — and made
      // connected-ads the 7-minute long pole of an E2E gate whose every other
      // lane finishes in under three.
      //
      // Neither render was this spec's subject, and both are already covered
      // nightly in `real-e2e`, on the same code paths and the same budgets:
      //   - src/real/create-video/create-video-dialog.spec.ts renders an
      //     organic video through that very dialog (waitForVideoReady, 8m).
      //   - src/real/create-graphic/create-graphic-dialog.spec.ts renders a
      //     graphic and regenerates it (waitForGraphicReady, 8m).
      // The graphic was the more obviously redundant of the two: it was
      // rendered, polled and URL-checked, and then never referenced again —
      // the ad is launched from the VIDEO.
      //
      // What is unique here, and what stays, is the JOIN: the ad wizard can
      // address one specific video record by `[data-video-id]` and launch a
      // live Meta ad from it. `launch-and-delete-ad` does not cover that — it
      // picks a seeded *asset* and never visits the video-selection step,
      // which is why it does a comparable job in 20 seconds.
      //
      // See ENG-803.
      const videoId = required(
        await seed.ensureCreatedVideo(),
        'seeded ready video id'
      );

      // ── 2. Seed a chatbot campaign ─────────────────────────────────────
      const campaign = await test.step('seed a chatbot campaign', async () => {
        const seeded = await ensureChatbotCampaign(seed);
        ids.campaignId = seeded.createdCampaignId;
        return seeded.campaign;
      });

      // ── 3. Run the ad wizard, selecting the video by data-video-id ──────
      await test.step('navigate to ad wizard', async () => {
        await page.goto('/ads/new');
        await expect(
          page.getByRole('heading', { name: /select a campaign/i })
        ).toBeVisible({ timeout: 30_000 });
      });

      await test.step('campaign step — select the seeded chatbot campaign', async () => {
        const campaignSelect = page.getByRole('combobox').first();
        await expect(campaignSelect).toBeVisible({ timeout: 15_000 });
        await campaignSelect.click();

        await page
          .getByRole('option')
          .filter({ hasText: campaign.name })
          .first()
          .click();

        // The follow-up badge proves we picked a CHATBOT campaign — only those
        // support the ad-launch flow this test drives.
        await expect(page.getByText('Chatbot', { exact: true })).toBeVisible({
          timeout: 10_000,
        });

        await clickThroughClaire(
          page,
          page.getByRole('button', { name: /^continue$/i })
        );
      });

      await test.step('details step — ad name, service, page', async () => {
        await expect(
          page.getByRole('heading', { name: /ad details/i })
        ).toBeVisible({ timeout: 15_000 });

        await page.getByLabel(/ad name/i).fill(adName);

        // Service: a searchable combobox listing active services. Pick the one
        // this run seeded, so the selection is deterministic.
        await page.getByRole('button', { name: /select a service/i }).click();
        await page.getByRole('option', { name: serviceName }).click();

        // The Facebook-Page list is Meta-backed: a Meta outage returns a
        // non-JSON "An error occurred" body, the dropdown stays empty, and the
        // click below would time out auto-waiting on a purely external
        // condition. Preflight it and skip cleanly instead — when Meta is
        // healthy this is a no-op and the page selection below still runs.
        await skipIfMetaUnavailable(page);

        // Facebook Page: the step auto-selects when the org has exactly one
        // page; clicking the first card is idempotent and covers >1 page.
        await page
          .getByRole('button')
          .filter({ hasText: /ID: / })
          .first()
          .click();

        await clickThroughClaire(
          page,
          page.getByRole('button', { name: /^continue$/i })
        );
      });

      await test.step('select media step — pick the FRESH video by data-video-id', async () => {
        // The media step opens on the generated-videos tab. Target the fresh
        // render by its data-video-id seam — proving the join, not just any
        // seeded media. A miss here means the render→ad join is broken, so it
        // must fail loudly rather than fall back to `.first()`.
        const freshCard = page.locator(`[data-video-id="${videoId}"]`);
        await expect(
          freshCard,
          `freshly rendered video ${videoId} appears in the wizard's media step (the render→ad join)`
        ).toBeVisible({ timeout: 60_000 });
        await freshCard.click();

        await clickThroughClaire(
          page,
          page.getByRole('button', { name: /^continue$/i })
        );
      });

      await test.step('customize step — wait for AI content, then publish', async () => {
        await expect(
          page.getByRole('heading', { name: /customize your ad/i })
        ).toBeVisible({ timeout: 15_000 });

        // `customize` is the LAST step: its primary button is Publish, which
        // reads "Generating..." / "Checking..." while it's blocked.
        const publishBtn = page.getByRole('button', { name: /^publish$/i });
        await expect(publishBtn).toBeEnabled({ timeout: 60_000 });
        await publishBtn.click();
      });

      await test.step('clear the pre-publish health check', async () => {
        await clearHealthCheck(page);
      });

      await test.step('confirm publish in modal', async () => {
        const publishDialog = page.locator('[role="dialog"]').filter({
          hasText: /publish ad/i,
        });
        await expect(publishDialog).toBeVisible({ timeout: 15_000 });

        const confirmBtn = publishDialog.getByRole('button', {
          name: /^publish$/i,
        });
        await expect(confirmBtn).toBeEnabled({ timeout: 10_000 });
        await confirmBtn.click();

        await expect(publishDialog).toBeHidden({ timeout: 60_000 });
      });

      // A throttled publish surfaces Meta's "Too Many Requests" dialog instead
      // of completing — skip cleanly rather than failing on the missing redirect.
      await skipIfMetaRateLimited(page);

      await test.step('verify ad published', async () => {
        await seed.assertNoError('publish ad');
        await page.waitForURL(/advertising/, { timeout: 30_000 });
      });

      // ── 4. Drive the ad to ACTIVE on Meta ──────────────────────────────
      await test.step('verify ad active on Meta', async () => {
        // There is no `[data-ad-id]` seam in the app — resolve the ad we just
        // published by its unique name via the API. Do this BEFORE polling for
        // ACTIVE so teardown can delete it even if activation times out.
        ids.adId = await resolvePublishedAdId(seed, campaign.id, adName);

        try {
          const { adStatus } = await seed.waitForAdActive(
            campaign.id,
            adName,
            300_000
          );
          expect(adStatus.toLowerCase()).toContain('active');
        } catch (error) {
          // Meta's own transient wobble ("temporary issue, try again in a few
          // minutes") lands on the ad row as a terminal error. External, not a
          // regression — everything else still fails. See meta.fixture.ts.
          skipIfMetaTransientAdFailure(error);
        }
      });
    } finally {
      await teardown(seed, ids);
    }
  });
});

// ── Module-scope helpers ───────────────────────────────────────────────────
// Everything below runs OUTSIDE the test body: seeding, resolution and
// teardown may branch; the test itself must not.

/** Assert a nullable value was captured, with a readable failure. */
function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${what} to be captured, but it was missing`);
  }
  return value;
}

/**
 * Guarantee a chatbot campaign the ad wizard can launch against. Reuses an
 * existing E2E chatbot campaign (Meta rate-limits the shared test ad account),
 * otherwise creates one and reports it so teardown removes only what we made.
 *
 * Throws — never skips — if the campaign cannot be created: an org that can't
 * hold a campaign can't run the ads suite, and that IS the regression.
 */
async function ensureChatbotCampaign(seed: SeedHelper): Promise<{
  campaign: SeededCampaign;
  createdCampaignId: string | null;
}> {
  const before = await seed.listCampaigns();
  const existing = before.find(isE2EChatbotCampaign);
  if (existing) {
    return { campaign: existing, createdCampaignId: null };
  }

  await seed.authenticatedApiCall('POST', '/meta-campaigns', {
    name: `E2E Render-to-Ad Campaign ${Date.now()}`,
    objective: 'OUTCOME_LEADS',
    // $5/day in cents — the campaign starts PAUSED, so no spend until publish.
    dailyBudget: 500,
    followUpType: 'chatbot',
    targeting: { countries: ['IE'] },
  });

  const after = await seed.listCampaigns();
  const created = after.find(
    (c) => isE2EChatbotCampaign(c) && !before.some((b) => b.id === c.id)
  );
  if (!created) {
    throw new Error(
      'Failed to seed an E2E chatbot campaign — the ad wizard cannot run without one'
    );
  }

  return { campaign: created, createdCampaignId: created.id };
}

/**
 * The wizard runs a health check before opening the publish-confirm modal. A
 * failing check surfaces HealthCheckDialog (proceed-able) and a budget-less
 * campaign surfaces NoBudgetDialog (fatal — we seed a budget, so it means the
 * campaign we picked is broken).
 */
async function clearHealthCheck(page: Page): Promise<void> {
  await expect(page.getByText('Checking...')).toBeHidden({ timeout: 30_000 });

  const noBudgetDialog = page
    .locator('[role="dialog"]')
    .filter({ hasText: /budget/i });
  if (
    await noBudgetDialog
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    throw new Error(
      'Campaign has no budget — cannot publish. The seeded campaign should carry a daily budget.'
    );
  }

  const healthDialog = page
    .locator('[role="dialog"]')
    .filter({ hasText: /health|check/i });
  const healthShown = await healthDialog
    .waitFor({ state: 'visible', timeout: 2_000 })
    .then(() => true)
    .catch(() => false);

  if (healthShown) {
    // Warnings on the shared ad account are expected; proceed through them.
    await healthDialog
      .getByRole('button', { name: /proceed|continue/i })
      .click();
    await expect(healthDialog).toBeHidden({ timeout: 15_000 });
  }
}

/**
 * Resolve the ad we just published by its unique name. The app renders no
 * `[data-ad-id]` seam, so the old DOM scrape silently left `adId` null and
 * orphaned every published ad on Meta. Polls briefly — the row lands a beat
 * after the redirect — then hard-fails.
 */
async function resolvePublishedAdId(
  seed: SeedHelper,
  campaignId: string,
  adName: string,
  timeoutMs = 60_000
): Promise<string> {
  const needle = adName.toLowerCase();
  const found: { id: string | null } = { id: null };

  await expect
    .poll(
      async () => {
        const ads = await seed.listAds(campaignId);
        found.id =
          ads.find((a) => a.name.toLowerCase().includes(needle))?.id ?? null;
        return found.id;
      },
      {
        timeout: timeoutMs,
        intervals: [5_000],
        message: `Published ad "${adName}" never appeared under campaign ${campaignId} — the publish did not create an ad`,
      }
    )
    .not.toBeNull();

  return required(found.id, `published ad id for "${adName}"`);
}

/** Tear down everything this run created — each delete isolated. */
async function teardown(seed: SeedHelper, ids: Teardown): Promise<void> {
  // Delete the published ad first (so it isn't orphaned if campaign deletion
  // fails / is skipped).
  if (ids.adId) {
    try {
      await seed.deleteAd(ids.adId);
    } catch (err) {
      console.warn('[render-to-live-ad] failed to delete ad:', err);
    }
  }

  // Delete the campaign only if THIS run created it.
  if (ids.campaignId) {
    try {
      await seed.deleteCampaign(ids.campaignId);
    } catch (err) {
      console.warn('[render-to-live-ad] failed to delete campaign:', err);
    }
  }

  // The video is NOT deleted. It is the shared `ensureCreatedVideo` fixture —
  // setup-connected, edit-ad, launch-and-delete-ad and video-playback all
  // depend on it, and it upserts on a deterministic id. Deleting it here would
  // pull the rug from the rest of the suite. This spec no longer creates a
  // video or a graphic of its own, so there is nothing of that kind to reap.

  if (ids.serviceId) {
    try {
      await seed.deleteServiceWithLinkedAssets(ids.serviceId);
    } catch (err) {
      console.warn('[render-to-live-ad] failed to delete service:', err);
    }
  }
}
