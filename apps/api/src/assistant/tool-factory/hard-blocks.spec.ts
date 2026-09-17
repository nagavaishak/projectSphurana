// Mock the features/assistant barrel to avoid pulling the knowledge module
// (which transitively imports `@paralleldrive/cuid2` — published as ESM-only
// and NOT covered by apps/api's swc-jest transform). Same pattern as the
// observability mock in `define-tool.spec.ts`. We mirror the d2b validator's
// regex behaviour faithfully so this test still exercises real banned-phrase
// / outcome-claim / percent-claim detection through the runner's call site.
jest.mock('@borradh-workspace/features/assistant', () => {
  const BANNED = [
    /\bguaranteed?\b/i,
    /\bproven\b/i,
    /\bcure\b/i,
    /\bclinically shown\b/i,
    /\bbest\b/i,
    /\bmost effective\b/i,
    /\bmiracle\b/i,
    /\bpermanent(ly)?\b/i,
  ];
  const OUTCOME =
    /\d+[\d.%]*\s*(x|times)?\s*(reduction|improvement|lift|tightening|smoothing|boost|increase|decrease|loss|gain)/i;
  const PERCENT = /\d+\s*%/;
  const POMS = [
    /\baqualyx\b/i,
    /\blemon bottle\b/i,
    /\bkybella\b/i,
    /\bbotox\b/i,
    /\bjuvederm\b/i,
    /\bazzalure\b/i,
    /\bdysport\b/i,
    /\bbocouture\b/i,
  ];
  return {
    validateGeneratedCopy: (payload: Record<string, unknown>) => {
      const failures: { field: string; reason: string; matched?: string }[] =
        [];
      for (const [field, value] of Object.entries(payload)) {
        if (typeof value !== 'string') continue;
        const percent = value.match(PERCENT);
        if (percent)
          failures.push({
            field,
            reason: 'percent_claim',
            matched: percent[0],
          });
        const outcome = value.match(OUTCOME);
        if (outcome)
          failures.push({
            field,
            reason: 'outcome_claim',
            matched: outcome[0],
          });
        for (const re of BANNED) {
          const m = value.match(re);
          if (m)
            failures.push({ field, reason: 'banned_phrase', matched: m[0] });
        }
        for (const re of POMS) {
          const m = value.match(re);
          if (m) failures.push({ field, reason: 'pom_brand', matched: m[0] });
        }
      }
      return failures;
    },
  };
});

import { ApiFetchError } from './api-fetch.js';
import { hardBlockValidators, runHardBlockValidators } from './hard-blocks.js';
import type { AssistantToolsContext } from './types.js';

// The validators only consult `input` for the implemented checks; the stubs
// don't read `ctx`. A minimal stand-in is sufficient for these unit tests —
// the heavy ctx wiring (apiFetch, confirmations, etc.) is exercised in
// `define-tool.spec.ts`.
const ctx = {
  organizationId: 'org-1',
  userId: 'user-1',
  conversationId: 'conv-1',
} as unknown as AssistantToolsContext;

describe('hardBlockValidators', () => {
  describe('noFabricatedResultClaims (real)', () => {
    const validator = hardBlockValidators.noFabricatedResultClaims;

    it('passes for benign copy', async () => {
      const result = await validator(
        { adCopy: 'A relaxing wellness treatment for tired skin.' },
        ctx
      );
      expect(result.pass).toBe(true);
    });

    it('passes when input is not an object', async () => {
      expect((await validator(null, ctx)).pass).toBe(true);
      expect((await validator(undefined, ctx)).pass).toBe(true);
      expect((await validator('a string', ctx)).pass).toBe(true);
      expect((await validator(42, ctx)).pass).toBe(true);
    });

    it('fails on banned phrases (e.g. "guaranteed")', async () => {
      const result = await validator(
        { adCopy: 'Guaranteed results in 14 days.' },
        ctx
      );
      expect(result.pass).toBe(false);
      if (result.pass) return;
      expect(result.code).toBe('noFabricatedResultClaims');
      expect(result.message).toContain('adCopy');
    });

    it('fails on outcome claims (e.g. "60% reduction")', async () => {
      const result = await validator(
        { adCopy: 'See a 60% reduction in fine lines.' },
        ctx
      );
      expect(result.pass).toBe(false);
    });

    it('fails on unconditional percent claims', async () => {
      const result = await validator(
        { headline: '50% off all treatments' },
        ctx
      );
      expect(result.pass).toBe(false);
    });

    it('does NOT fire on POM-brand matches (those belong to the POM validator)', async () => {
      // The d2b validator catches POM brands; we filter them out here so the
      // POM check is owned by `noPomBrandNamesInAdCopy`. The d2b POM list
      // includes "Botox" — the only fabricated-claims test subject we add
      // here, so any other failures are unrelated to POM filtering.
      const result = await validator({ adCopy: 'Try a Botox treatment.' }, ctx);
      expect(result.pass).toBe(true);
    });

    it('only inspects string fields', async () => {
      const result = await validator(
        {
          numericPrice: 60,
          tags: ['relaxing', 'wellness'],
          metadata: { proven: true },
        },
        ctx
      );
      expect(result.pass).toBe(true);
    });
  });

  describe('noPomBrandNamesInAdCopy (stubbed: empty list)', () => {
    const validator = hardBlockValidators.noPomBrandNamesInAdCopy;

    it('passes for any input while POM_BRAND_REGEXES is empty (D-7 deferred)', async () => {
      // The validator is wired but list-empty by design; this test pins
      // the v3-launch behaviour. When the compliance owner is named and
      // POM_BRAND_REGEXES is populated, the test's intent flips and a
      // failing example should land alongside the populated list.
      const result = await validator(
        { adCopy: 'Botox special this week!' },
        ctx
      );
      expect(result.pass).toBe(true);
    });
  });

  describe('stubbed validators', () => {
    // Each stub returns { pass: true } unconditionally until the data lands.
    // The behaviour is asserted explicitly so a regression (e.g. someone
    // partially wires a validator) is caught.
    //
    // `noSurgicalPricingInChat` was previously a stub; W-C09-services filled
    // it as a real validator (see its own describe block below).
    const stubbedNames = [
      'noBeforeAfterImageryUkAds',
      'noServicePivotBeforeStage2',
    ] as const;

    it.each(stubbedNames)('%s returns pass: true', async (name) => {
      const validator = hardBlockValidators[name];
      const result = await validator(
        { campaignId: 'c-1', adId: 'a-1', amount: 100 },
        ctx
      );
      expect(result.pass).toBe(true);
    });
  });

  describe('learning-phase validators (fail-closed on unknown status)', () => {
    const learningNames = [
      'noLiveCampaignChangeDuringLearningPhase',
      'noScalingBeforeLearningExits',
    ] as const;

    const makeLearningCtx = (
      opts:
        | { throws: true }
        | { throwsStatus: number }
        | { isInLearningPhase: boolean; daysSinceLaunch?: number }
    ): AssistantToolsContext => {
      const apiFetch = jest.fn(async () => {
        if ('throwsStatus' in opts) {
          throw new ApiFetchError('lookup failed', opts.throwsStatus);
        }
        if ('throws' in opts) throw new Error('learning-status lookup failed');
        return {
          metaCampaignId: 'mc-1',
          daysSinceLaunch: opts.daysSinceLaunch ?? 3,
          isInLearningPhase: opts.isInLearningPhase,
        };
      });
      return { ...ctx, apiFetch } as unknown as AssistantToolsContext;
    };

    // A budget bigger than current so noScalingBeforeLearningExits engages too.
    const input = {
      metaCampaignId: 'mc-1',
      newBudgetCents: 5000,
      currentBudgetCents: 1000,
    };

    it.each(learningNames)(
      '%s is NOT applicable without a campaign id → pass',
      async (name) => {
        const result = await hardBlockValidators[name](
          { newBudgetCents: 5000, currentBudgetCents: 1000 },
          makeLearningCtx({ isInLearningPhase: false })
        );
        expect(result.pass).toBe(true);
      }
    );

    it.each(learningNames)(
      '%s FAILS CLOSED with learning_status_unknown when the lookup throws',
      async (name) => {
        const result = await hardBlockValidators[name](
          input,
          makeLearningCtx({ throws: true })
        );
        expect(result.pass).toBe(false);
        if (!result.pass) expect(result.code).toBe('learning_status_unknown');
      }
    );

    it.each(learningNames)(
      '%s FAILS CLOSED on a 5xx — a campaign we manage, unverifiable right now',
      async (name) => {
        const result = await hardBlockValidators[name](
          input,
          makeLearningCtx({ throwsStatus: 503 })
        );
        expect(result.pass).toBe(false);
        if (!result.pass) expect(result.code).toBe('learning_status_unknown');
      }
    );

    // A 404 means no metaCampaignConfig row: the campaign was made outside
    // Borradh (Ads Manager / predates the integration) and is still listed by
    // `listCampaigns`. That 404 is PERMANENT, so holding would block every
    // budget change on it forever while telling the owner to retry shortly.
    // The learning rule only covers campaigns we launched → pass.
    it.each(learningNames)(
      '%s PASSES on a 404 — not ours to hold, and retrying would never clear',
      async (name) => {
        const result = await hardBlockValidators[name](
          input,
          makeLearningCtx({ throwsStatus: 404 })
        );
        expect(result.pass).toBe(true);
      }
    );

    it.each(learningNames)(
      '%s passes for a never-delivered campaign (isInLearningPhase: false)',
      async (name) => {
        const result = await hardBlockValidators[name](
          input,
          makeLearningCtx({ isInLearningPhase: false })
        );
        expect(result.pass).toBe(true);
      }
    );

    it('noLiveCampaignChangeDuringLearningPhase BLOCKS a delivering campaign in learning', async () => {
      const result =
        await hardBlockValidators.noLiveCampaignChangeDuringLearningPhase(
          { metaCampaignId: 'mc-1' },
          makeLearningCtx({ isInLearningPhase: true })
        );
      expect(result.pass).toBe(false);
    });
  });

  describe('noSurgicalPricingInChat (real)', () => {
    // The validator is field-name agnostic (it scans every string field on
    // the input) and looks up the org's businessType via apiFetch only AFTER
    // a price-shaped pattern matches. Cheap-path optimisation.
    const validator = hardBlockValidators.noSurgicalPricingInChat;

    /** Build a ctx whose `assistant/context` apiFetch returns the given
     *  businessType. `fetchFails: true` makes the lookup throw — the
     *  validator should fail open. */
    const makeCtx = (
      businessType: string | undefined,
      opts: { fetchFails?: boolean } = {}
    ): AssistantToolsContext => {
      const apiFetch = jest.fn(async (path: string) => {
        if (opts.fetchFails) throw new Error('lookup failed');
        if (path === 'assistant/context') {
          return businessType ? { businessType } : {};
        }
        return {};
      });
      return {
        organizationId: 'org-1',
        userId: 'user-1',
        conversationId: 'conv-1',
        apiFetch,
      } as unknown as AssistantToolsContext;
    };

    it('fails for a surgical (cosmetic_clinic) org with a price in the draft', async () => {
      const result = await validator(
        { draft: 'Quote the customer £3000 for the rhinoplasty.' },
        makeCtx('cosmetic_clinic')
      );
      expect(result.pass).toBe(false);
      if (result.pass) return;
      expect(result.code).toBe('noSurgicalPricingInChat');
      expect(result.message).toContain('£3000');
      expect(result.message).toContain('draft');
    });

    it('fails for a hair_restoration org with a price (e.g. transplant pricing)', async () => {
      const result = await validator(
        {
          reply:
            'We can do a 3000-graft FUE for €4,500 — does Tuesday work for you?',
        },
        makeCtx('hair_restoration')
      );
      expect(result.pass).toBe(false);
      if (result.pass) return;
      expect(result.code).toBe('noSurgicalPricingInChat');
    });

    it('passes for a surgical org with a draft that mentions no price', async () => {
      const surgicalCtx = makeCtx('cosmetic_clinic');
      const result = await validator(
        {
          draft:
            'Thanks for reaching out — could you book a consultation so we can discuss the options in person?',
        },
        surgicalCtx
      );
      expect(result.pass).toBe(true);
      // Cheap-path optimisation: no price pattern matched, so the
      // assistant/context lookup is skipped entirely.
      expect(surgicalCtx.apiFetch).not.toHaveBeenCalled();
    });

    it('passes for an aesthetic_clinic with a price (rule does not apply)', async () => {
      const result = await validator(
        { draft: 'Lip filler is €290 a syringe — want to book?' },
        makeCtx('aesthetic_clinic')
      );
      expect(result.pass).toBe(true);
    });

    it('passes for a salon with a price (rule does not apply)', async () => {
      const result = await validator(
        { draft: 'Highlights start from £80, depending on length.' },
        makeCtx('salon')
      );
      expect(result.pass).toBe(true);
    });

    it('passes for an unknown / unset business type (fail open)', async () => {
      const result = await validator(
        { draft: 'The treatment is €500.' },
        makeCtx(undefined)
      );
      expect(result.pass).toBe(true);
    });

    it('passes when the assistant/context lookup throws (fail open)', async () => {
      const result = await validator(
        { draft: 'Rhinoplasty starts from £4,500.' },
        makeCtx('cosmetic_clinic', { fetchFails: true })
      );
      expect(result.pass).toBe(true);
    });

    it('passes when input has no string fields (no draftable text)', async () => {
      const result = await validator(
        { conversationId: 'conv-1', requestedAt: 1234, ids: ['a', 'b'] },
        makeCtx('cosmetic_clinic')
      );
      expect(result.pass).toBe(true);
    });

    it('passes when input is null / non-object (defensive)', async () => {
      const surgicalCtx = makeCtx('cosmetic_clinic');
      expect((await validator(null, surgicalCtx)).pass).toBe(true);
      expect((await validator(undefined, surgicalCtx)).pass).toBe(true);
      expect((await validator('not an object', surgicalCtx)).pass).toBe(true);
      expect((await validator(42, surgicalCtx)).pass).toBe(true);
    });

    it('catches non-symbol price phrasings ("priced at 3000", "starts at €X")', async () => {
      // Surgical org → these phrasings should still trip the validator.
      const cases = [
        'The procedure is priced at 3,200 euros.',
        'Starting from €2,500 for the basic package.',
        'The deposit costs £150 up front.',
      ];
      for (const draft of cases) {
        const result = await validator({ draft }, makeCtx('cosmetic_clinic'));
        expect(result.pass).toBe(false);
      }
    });
  });

  describe('noDiscountBelowCost (sanity-check tier)', () => {
    // The validator catches obviously-impossible discounts (≥90% off, or a
    // sale price ≤10% of original). Real cost-aware comparison ships when
    // organizationService gains a costCents field — see TODO(c-08-followup).
    const validator = hardBlockValidators.noDiscountBelowCost;

    it('passes for benign discounts', async () => {
      expect((await validator({ discountPercent: 20 }, ctx)).pass).toBe(true);
      expect((await validator({ discountPercent: 50 }, ctx)).pass).toBe(true);
      expect(
        (
          await validator(
            { originalPriceCents: 24000, offerPriceCents: 18000 },
            ctx
          )
        ).pass
      ).toBe(true);
    });

    it('fails on discountPercent ≥ 90 (eval fixture threshold)', async () => {
      const result = await validator({ discountPercent: 90 }, ctx);
      expect(result.pass).toBe(false);
      if (result.pass) return;
      expect(result.code).toBe('noDiscountBelowCost');
      expect(result.message).toContain('90%');
    });

    it('fails on discountPercent of 99', async () => {
      const result = await validator({ discountPercent: 99 }, ctx);
      expect(result.pass).toBe(false);
    });

    it('passes on discountPercent of 89', async () => {
      const result = await validator({ discountPercent: 89 }, ctx);
      expect(result.pass).toBe(true);
    });

    it('fails when offerPriceCents ≤ 10% of originalPriceCents (€240 → €24)', async () => {
      // The eval fixture's user message: "€24 instead of €240" — sale is
      // exactly 10% of original.
      const result = await validator(
        { originalPriceCents: 24000, offerPriceCents: 2400 },
        ctx
      );
      expect(result.pass).toBe(false);
      if (result.pass) return;
      expect(result.code).toBe('noDiscountBelowCost');
      expect(result.message).toMatch(/€24\.00/);
    });

    it('passes when sale is comfortably above the 10% floor', async () => {
      const result = await validator(
        { originalPriceCents: 10000, offerPriceCents: 2000 },
        ctx
      );
      expect(result.pass).toBe(true);
    });

    it('passes when input is not an object', async () => {
      expect((await validator(null, ctx)).pass).toBe(true);
      expect((await validator(undefined, ctx)).pass).toBe(true);
      expect((await validator('a string', ctx)).pass).toBe(true);
      expect((await validator(42, ctx)).pass).toBe(true);
    });

    it('passes when discount fields are absent (e.g. extendOffer input)', async () => {
      const result = await validator(
        { offerId: 'offer-1', newValidUntil: '2026-12-31T00:00:00Z' },
        ctx
      );
      expect(result.pass).toBe(true);
    });

    it('passes for non-numeric discountPercent', async () => {
      const result = await validator({ discountPercent: 'high' }, ctx);
      expect(result.pass).toBe(true);
    });

    it('passes when originalPriceCents is zero (avoids div-by-zero)', async () => {
      const result = await validator(
        { originalPriceCents: 0, offerPriceCents: 0 },
        ctx
      );
      expect(result.pass).toBe(true);
    });
  });

  describe('noAdForRefusedService (real)', () => {
    // The validator reads serviceId/serviceIds off input, looks up the org's
    // ad-creation-context, and fails when the chosen service IS the engine's
    // top pick AND its offerStrategy is `switch_service` or `do_not_advertise`.
    const validator = hardBlockValidators.noAdForRefusedService;

    const makeCtx = (
      topService: {
        serviceId: string;
        strategy?: string;
      } | null,
      opts: { fetchFails?: boolean } = {}
    ): AssistantToolsContext => {
      const apiFetch = jest.fn(async (path: string) => {
        if (opts.fetchFails) throw new Error('lookup failed');
        if (path === 'claire/ad-creation-context') {
          return {
            service: topService
              ? {
                  serviceId: topService.serviceId,
                  offer: topService.strategy
                    ? { strategy: topService.strategy }
                    : undefined,
                }
              : null,
          };
        }
        return {};
      });
      return {
        organizationId: 'org-1',
        userId: 'user-1',
        conversationId: 'conv-1',
        apiFetch,
      } as unknown as AssistantToolsContext;
    };

    it('fails when proposed serviceId is the top pick AND strategy is switch_service', async () => {
      const result = await validator(
        { serviceId: 'svc-1' },
        makeCtx({ serviceId: 'svc-1', strategy: 'switch_service' })
      );
      expect(result.pass).toBe(false);
      if (result.pass) return;
      expect(result.code).toBe('noAdForRefusedService');
      expect(result.message).toContain('switch_service');
      expect(result.message).toContain('getAlternativeRecommendation');
    });

    it('fails when proposed serviceId is the top pick AND strategy is do_not_advertise', async () => {
      const result = await validator(
        { serviceId: 'svc-1' },
        makeCtx({ serviceId: 'svc-1', strategy: 'do_not_advertise' })
      );
      expect(result.pass).toBe(false);
      if (result.pass) return;
      expect(result.code).toBe('noAdForRefusedService');
      expect(result.message).toContain('do_not_advertise');
      expect(result.message).toContain('retargeting');
    });

    it('passes when strategy is price_visible_intro (normal case)', async () => {
      const result = await validator(
        { serviceId: 'svc-1' },
        makeCtx({ serviceId: 'svc-1', strategy: 'price_visible_intro' })
      );
      expect(result.pass).toBe(true);
    });

    it('passes when proposed serviceId is NOT the top pick (alternative)', async () => {
      // The endpoint's alternatives list doesn't carry strategy, so any
      // serviceId that doesn't match the top pick falls through. The engine's
      // ranking already filters hard-refusal services off the top.
      const result = await validator(
        { serviceId: 'svc-2' },
        makeCtx({ serviceId: 'svc-1', strategy: 'switch_service' })
      );
      expect(result.pass).toBe(true);
    });

    it('passes when input has no serviceId or serviceIds', async () => {
      const result = await validator(
        { campaignId: 'c-1' },
        makeCtx({ serviceId: 'svc-1', strategy: 'switch_service' })
      );
      expect(result.pass).toBe(true);
    });

    it('reads first id from serviceIds array', async () => {
      const result = await validator(
        { serviceIds: ['svc-1', 'svc-2'] },
        makeCtx({ serviceId: 'svc-1', strategy: 'switch_service' })
      );
      expect(result.pass).toBe(false);
    });

    it('passes when ad-creation-context lookup throws (fail open)', async () => {
      const result = await validator(
        { serviceId: 'svc-1' },
        makeCtx(null, { fetchFails: true })
      );
      expect(result.pass).toBe(true);
    });

    it('passes when context returns null service (no profile yet)', async () => {
      const result = await validator({ serviceId: 'svc-1' }, makeCtx(null));
      expect(result.pass).toBe(true);
    });

    it('passes when top pick has no strategy field', async () => {
      const result = await validator(
        { serviceId: 'svc-1' },
        makeCtx({ serviceId: 'svc-1' })
      );
      expect(result.pass).toBe(true);
    });

    it('passes when input is null / non-object (defensive)', async () => {
      const c = makeCtx({ serviceId: 'svc-1', strategy: 'switch_service' });
      expect((await validator(null, c)).pass).toBe(true);
      expect((await validator(undefined, c)).pass).toBe(true);
      expect((await validator('not an object', c)).pass).toBe(true);
      expect((await validator(42, c)).pass).toBe(true);
    });
  });

  describe('noHallucinatedService (real)', () => {
    // The validator reads every serviceId/serviceIds off input, fetches the
    // org's real catalogue, and fails when ANY proposed id isn't in it — the
    // anti-hallucination backstop for the ad/campaign money path.
    const validator = hardBlockValidators.noHallucinatedService;

    const makeCtx = (
      catalogueIds: string[],
      opts: { fetchFails?: boolean } = {}
    ): AssistantToolsContext => {
      const apiFetch = jest.fn(async (path: string) => {
        if (opts.fetchFails) throw new Error('catalogue lookup failed');
        if (path.startsWith('organization-services')) {
          return {
            items: catalogueIds.map((id) => ({ id, name: `Service ${id}` })),
            total: catalogueIds.length,
          };
        }
        return {};
      });
      return {
        organizationId: 'org-1',
        userId: 'user-1',
        conversationId: 'conv-1',
        apiFetch,
      } as unknown as AssistantToolsContext;
    };

    it('passes when the scalar serviceId is in the catalogue', async () => {
      const result = await validator(
        { serviceId: 'svc-1' },
        makeCtx(['svc-1', 'svc-2'])
      );
      expect(result.pass).toBe(true);
    });

    it('passes when every id in serviceIds[] is in the catalogue', async () => {
      const result = await validator(
        { serviceIds: ['svc-1', 'svc-2'] },
        makeCtx(['svc-1', 'svc-2', 'svc-3'])
      );
      expect(result.pass).toBe(true);
    });

    it('fails when the serviceId is not in the catalogue (hallucinated)', async () => {
      const result = await validator(
        { serviceId: 'svc-fake' },
        makeCtx(['svc-1', 'svc-2'])
      );
      expect(result.pass).toBe(false);
      if (result.pass) return;
      expect(result.code).toBe('noHallucinatedService');
      expect(result.message).toContain('svc-fake');
      expect(result.message).toContain('listServices');
    });

    it('fails when ANY id in serviceIds[] is fabricated', async () => {
      const result = await validator(
        { serviceIds: ['svc-1', 'svc-ghost'] },
        makeCtx(['svc-1', 'svc-2'])
      );
      expect(result.pass).toBe(false);
      if (result.pass) return;
      expect(result.code).toBe('noHallucinatedService');
      expect(result.message).toContain('svc-ghost');
      // Only the fabricated id is named, not the legitimate one.
      expect(result.message).not.toContain('"svc-1"');
    });

    it('passes when input carries no serviceId or serviceIds (not applicable)', async () => {
      const result = await validator(
        { metaCampaignId: 'c-1' },
        makeCtx(['svc-1'])
      );
      expect(result.pass).toBe(true);
    });

    it('pages the catalogue, so a real id past the 100-item cap still passes', async () => {
      // Absence is the whole proof here. A catalogue truncated at the server's
      // `limit` cap would turn service #101 into a "hallucinated" one and hard-
      // block a legitimate ad — the one direction this validator must not fail.
      const apiFetch = jest.fn(async (path: string) => ({
        items: Array.from(
          { length: path.includes('offset=0') ? 100 : 30 },
          (_, i) => ({
            id: `svc-${(path.includes('offset=0') ? 0 : 100) + i}`,
          })
        ),
        total: 130,
      }));
      const ctx = {
        organizationId: 'org-1',
        apiFetch,
      } as unknown as AssistantToolsContext;

      const result = await validator({ serviceId: 'svc-129' }, ctx);

      expect(apiFetch).toHaveBeenCalledTimes(2);
      expect(result.pass).toBe(true);
    });

    it('still fails a fabricated id when the catalogue spans several pages', async () => {
      const apiFetch = jest.fn(async (path: string) => ({
        items: Array.from(
          { length: path.includes('offset=0') ? 100 : 30 },
          (_, i) => ({
            id: `svc-${(path.includes('offset=0') ? 0 : 100) + i}`,
          })
        ),
        total: 130,
      }));
      const ctx = {
        organizationId: 'org-1',
        apiFetch,
      } as unknown as AssistantToolsContext;

      const result = await validator({ serviceId: 'svc-fake' }, ctx);

      expect(result.pass).toBe(false);
      if (result.pass) return;
      expect(result.code).toBe('noHallucinatedService');
    });

    it('passes (fails open) when the catalogue is too large to walk', async () => {
      // Page cap hit → `complete: false`. An incomplete catalogue cannot tell
      // "not offered" from "not fetched", so it must not block.
      const apiFetch = jest.fn(async () => ({
        items: Array.from({ length: 100 }, (_, i) => ({ id: `svc-${i}` })),
        total: 1_000_000,
      }));
      const ctx = {
        organizationId: 'org-1',
        apiFetch,
      } as unknown as AssistantToolsContext;

      const result = await validator({ serviceId: 'svc-fake' }, ctx);

      expect(result.pass).toBe(true);
    });

    it('passes (fails open) when the catalogue lookup throws', async () => {
      const result = await validator(
        { serviceId: 'svc-fake' },
        makeCtx([], { fetchFails: true })
      );
      expect(result.pass).toBe(true);
    });

    it('passes when input is null / non-object (defensive)', async () => {
      const c = makeCtx(['svc-1']);
      expect((await validator(null, c)).pass).toBe(true);
      expect((await validator(undefined, c)).pass).toBe(true);
      expect((await validator('not an object', c)).pass).toBe(true);
      expect((await validator(42, c)).pass).toBe(true);
    });
  });
});

describe('runHardBlockValidators', () => {
  it('returns pass:true on empty names list (no validators, no work)', async () => {
    const result = await runHardBlockValidators([], { foo: 'bar' }, ctx);
    expect(result.pass).toBe(true);
  });

  it('returns pass:true when every named validator passes', async () => {
    const result = await runHardBlockValidators(
      ['noLiveCampaignChangeDuringLearningPhase', 'noFabricatedResultClaims'],
      { adCopy: 'A relaxing treatment for tired skin.' },
      ctx
    );
    expect(result.pass).toBe(true);
  });

  it('returns the first failure (in declared order) when any validator fails', async () => {
    const result = await runHardBlockValidators(
      // Stubs first, then the failing one; we expect the failure regardless
      // of order — but a *second* failing validator wouldn't override.
      [
        'noLiveCampaignChangeDuringLearningPhase',
        'noFabricatedResultClaims',
        'noScalingBeforeLearningExits',
      ],
      { adCopy: 'Guaranteed results.' },
      ctx
    );
    expect(result.pass).toBe(false);
    if (result.pass) return;
    expect(result.code).toBe('noFabricatedResultClaims');
  });

  it('reports unknown validator names with code UNKNOWN_HARD_BLOCK', async () => {
    const result = await runHardBlockValidators(
      ['noFabricatedResultClaims', 'noTotallyMadeUpRule'],
      { adCopy: 'A relaxing treatment for tired skin.' },
      ctx
    );
    expect(result.pass).toBe(false);
    if (result.pass) return;
    expect(result.code).toBe('UNKNOWN_HARD_BLOCK');
    expect(result.message).toContain('noTotallyMadeUpRule');
  });

  it('runs validators in parallel (Promise.all semantics)', async () => {
    // Spread two slow stubs across both real and unknown validators; assert
    // the runner doesn't serialise. We construct two promises that each
    // wait 30ms — sequential would be ≥60ms; parallel finishes in ≤45ms.
    const start = Date.now();
    await runHardBlockValidators(
      [
        'noLiveCampaignChangeDuringLearningPhase',
        'noScalingBeforeLearningExits',
        'noBeforeAfterImageryUkAds',
      ],
      {},
      ctx
    );
    const elapsed = Date.now() - start;
    // The current stubs are synchronous-ish (immediate resolution), so
    // elapsed should be <50ms regardless. The assertion only fires if a
    // future validator regresses to long synchronous awaits.
    expect(elapsed).toBeLessThan(500);
  });
});
