/**
 * Claire hard-block validator library.
 *
 * The skill registry (`packages/features/src/assistant/skills/`) declares
 * which named validators each skill's tools must pass before a destructive
 * action runs. The factory's `defineTool` config carries those names through
 * to the wrapped execute, which calls `runHardBlockValidators` here.
 *
 * Wiring at a glance:
 *   skill.hardBlocks: ['noFabricatedResultClaims']
 *     → tool.config.hardBlocks: same names
 *     → factory wrapped execute: ctx.runHardBlocks(names, input, ctx)
 *     → tool-context default: runHardBlockValidators (this module)
 *     → hardBlockValidators[name](input, ctx)
 *
 * Defense-in-depth posture: the orchestrator's prompt also tells the model
 * not to do these things. The validators are the backstop — if the model
 * proposes a destructive action that violates a rule, the factory catches it
 * BEFORE the action executes (and BEFORE a confirmation token is issued).
 *
 * Several validators are stubbed pending Phase 2/3 data. Each carries a
 * `TODO(c-XX)` marker pointing at the track that ships the needed data.
 *
 * @see docs/plans/claire-shared-spec.md §3 (the canonical hard-blocks list)
 * @see docs/implementations/claire.md §2 (Hard blocks: defense in depth)
 * @see docs/implementations/claire-briefs/track-c02.md §Step 5
 */

import { validateGeneratedCopy } from '@borradh-workspace/features/assistant';
import { ApiFetchError } from './api-fetch.js';
import { fetchServiceCatalogue } from './service-catalogue.js';
import type {
  AssistantToolsContext,
  HardBlockResult,
  HardBlockRunner,
} from './types.js';

/** Per-validator signature. Mirrors `HardBlockRunner` for a single validator. */
export type HardBlockValidator = (
  input: unknown,
  ctx: AssistantToolsContext
) => Promise<HardBlockResult>;

// ---------------------------------------------------------------------------
// Stubbed validators
// ---------------------------------------------------------------------------
// All stubs return `{ pass: true }`. Each documents the missing data + the
// track that will ship it. The factory still enforces the rest of the chain
// (input validation, confirmation tokens, telemetry) — stubs just mean the
// "is this campaign in learning phase?" check is a no-op for now.

/**
 * Resolve the `metaCampaignId` for a given tool input. Some destructive
 * ad tools (e.g. `executeLaunchAd`) take an internal `adId` rather than a
 * Meta campaign ID; the model is responsible for echoing both — but it
 * doesn't always. Returning `null` here means "not applicable" and the
 * validator passes by default. The factory's hard-block aggregator surfaces
 * a real failure only when we actively prove the campaign is in learning.
 */
function readCampaignId(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const candidates = ['metaCampaignId', 'campaignId'] as const;
  for (const key of candidates) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

interface CampaignLearningStatusResponse {
  metaCampaignId: string;
  daysSinceLaunch: number;
  isInLearningPhase: boolean;
}

/**
 * Fail-closed result when the learning-phase lookup can't be completed. Both
 * learning validators return this on a TRANSIENT lookup error: a change we
 * can't verify is held rather than let through, so we never silently reset a
 * live campaign's learning phase (register #82/#94). The owner sees the reason
 * and can retry — and a retry can actually succeed, which is what makes
 * holding the right call here.
 */
const LEARNING_STATUS_UNKNOWN: HardBlockResult = {
  pass: false,
  code: 'learning_status_unknown',
  message:
    "I couldn't verify whether this campaign is still in Meta's learning " +
    "phase, so I'm holding this change rather than risk resetting the " +
    'algorithm. Give it a moment and ask me to try again.',
};

/**
 * Classify a learning-status lookup failure into pass-or-hold.
 *
 * A 404 is NOT transient and NOT a verification failure: it means no
 * `metaCampaignConfig` row exists for this (org, campaign) — i.e. the campaign
 * was not created by Borradh. `listCampaigns` returns every campaign on the
 * connected ad account and left-joins config, so campaigns made in Ads Manager
 * (or predating the integration) are addressable here and will 404 forever.
 * Holding them would block every budget change on such a campaign permanently
 * while telling the owner to "try again in a moment" — advice that can never
 * come true. The learning-phase rule is scoped to campaigns we launched and
 * whose delivery we track, so a campaign we have no record of passes.
 *
 * Everything else (5xx, network, contract drift) IS a verification failure of
 * a campaign we do manage → fail closed.
 */
function classifyLearningStatusFailure(error: unknown): HardBlockResult {
  if (error instanceof ApiFetchError && error.status === 404) {
    return { pass: true };
  }
  return LEARNING_STATUS_UNKNOWN;
}

/**
 * Block changes to live campaigns during Meta's 7–10 day learning phase
 * (W-C05).
 *
 * Looks up the campaign via `GET /meta-campaigns/:id/learning-status` —
 * the lookup is owned by the `getCampaignLearningStatus` feature service
 * (`packages/features/src/meta-campaigns/services/get-campaign-learning-status/`)
 * to keep DB access out of `apps/api/src` per `feedback_no_db_in_api`.
 *
 * Note: `isInLearningPhase` is true only for a campaign that has actually
 * started DELIVERING (served impressions) AND is within the day-10 window.
 * A freshly-created campaign that hasn't delivered yet reports `false`, so
 * correcting a just-set budget is not blocked. That gating lives in the
 * feature service; this validator just reads the flag.
 *
 * Behaviour:
 *   - No `metaCampaignId` on input → pass (validator not applicable).
 *   - Lookup FAILS transiently (5xx, network, contract drift) → FAIL CLOSED
 *     with `learning_status_unknown` (register #82/#94). Changing a campaign
 *     we can't verify risks resetting a live learning phase; holding and
 *     asking the owner to retry is the safe default. This replaced the old
 *     fail-open behaviour, which let an unverifiable change through silently.
 *   - Lookup 404s → pass. Not a verification failure: we simply have no
 *     record of the campaign, so it isn't one we launched and the rule does
 *     not apply. See {@link classifyLearningStatusFailure}.
 *   - `isInLearningPhase: true` → block.
 *   - never-launched / paused / zero-spend → `isInLearningPhase: false` (the
 *     feature service gates on actual delivery) → pass.
 */
const noLiveCampaignChangeDuringLearningPhase: HardBlockValidator = async (
  input,
  ctx
) => {
  const metaCampaignId = readCampaignId(input);
  if (!metaCampaignId) return { pass: true };

  let status: CampaignLearningStatusResponse;
  try {
    status = await ctx.apiFetch<CampaignLearningStatusResponse>(
      `meta-campaigns/${encodeURIComponent(metaCampaignId)}/learning-status`
    );
  } catch (error) {
    return classifyLearningStatusFailure(error);
  }

  if (!status.isInLearningPhase) return { pass: true };

  return {
    pass: false,
    code: 'noLiveCampaignChangeDuringLearningPhase',
    message: `That campaign is still in Meta's learning phase (day ${status.daysSinceLaunch} of 10). Changing it now resets the algorithm's progress — let's wait until day 10 and revisit.`,
  };
};

/**
 * Block budget scaling before the learning phase exits — same data
 * dependency as above, scoped to actions where the new daily budget is
 * larger than the current one. As with the companion validator,
 * `isInLearningPhase` requires the campaign to have actually started
 * delivering, so scaling a not-yet-delivering campaign's budget is allowed.
 *
 * The validator reads `currentBudgetCents` and `newBudgetCents` (or the
 * raw `dailyBudget` on `executeUpdateBudget`) directly off the proposed
 * input. If the new budget isn't larger, this is a *de*-scale and the
 * companion `noLiveCampaignChangeDuringLearningPhase` handles it.
 */
const noScalingBeforeLearningExits: HardBlockValidator = async (input, ctx) => {
  const metaCampaignId = readCampaignId(input);
  if (!metaCampaignId) return { pass: true };

  if (!input || typeof input !== 'object') return { pass: true };
  const obj = input as Record<string, unknown>;
  const newBudget =
    typeof obj.newBudgetCents === 'number'
      ? obj.newBudgetCents
      : typeof obj.dailyBudget === 'number'
        ? obj.dailyBudget
        : null;
  const currentBudget =
    typeof obj.currentBudgetCents === 'number' ? obj.currentBudgetCents : null;

  // Skip when we can't see a numeric new budget. `executeUpdateBudget`
  // always carries `dailyBudget`; `confirmUpdateBudget` carries both.
  if (newBudget === null) return { pass: true };
  // De-scale or no-op: not in scope for this validator.
  if (currentBudget !== null && newBudget <= currentBudget) {
    return { pass: true };
  }

  let status: CampaignLearningStatusResponse;
  try {
    status = await ctx.apiFetch<CampaignLearningStatusResponse>(
      `meta-campaigns/${encodeURIComponent(metaCampaignId)}/learning-status`
    );
  } catch (error) {
    return classifyLearningStatusFailure(error);
  }

  if (!status.isInLearningPhase) return { pass: true };

  return {
    pass: false,
    code: 'noScalingBeforeLearningExits',
    message: `Scaling a campaign that's still in Meta's learning phase (day ${status.daysSinceLaunch} of 10) resets the algorithm. Wait until learning exits, then we'll revisit the budget.`,
  };
};

/**
 * Block POM (prescription-only medicine) brand names in ad copy.
 *
 * The list is intentionally empty for v3 launch — D-7 in claire.md §6 is
 * deferred to the compliance pass with a named human owner. This validator
 * is wired and ready: the moment `POM_BRAND_REGEXES` is populated, every
 * skill that declares `noPomBrandNamesInAdCopy` starts firing.
 *
 * Note: a parallel POM list lives in `validateGeneratedCopy`
 * (`packages/features/src/assistant/services/generate-recommendation-payload/d2b-validator.ts`).
 * That one fires at recommendation-content generation time. This factory
 * validator fires at tool-execute time, on the proposed input — defense in
 * depth across the two surfaces. When the compliance owner is named, both
 * lists get populated together (or replaced by a single shared config).
 *
 * TODO(d-7): populate POM_BRAND_REGEXES once the compliance owner is named.
 */
const POM_BRAND_REGEXES: readonly RegExp[] = [];

const noPomBrandNamesInAdCopy: HardBlockValidator = async (input) => {
  if (POM_BRAND_REGEXES.length === 0) return { pass: true };
  if (!input || typeof input !== 'object') return { pass: true };
  for (const value of Object.values(input as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    for (const re of POM_BRAND_REGEXES) {
      const match = value.match(re);
      if (match) {
        return {
          pass: false,
          code: 'noPomBrandNamesInAdCopy',
          message: `Ad copy can't name a prescription-only medicine ("${match[0]}"). Use a category description instead.`,
        };
      }
    }
  }
  return { pass: true };
};

/**
 * Block before/after imagery in UK ads (ASA simplification — owned by the
 * compliance pass, 2c).
 *
 * STUB — image-content metadata isn't part of tool input until C-12 wires
 * the attachment pipeline. The country-of-org check is also not exposed in
 * `AssistantContext` yet (only `address` is present, and parsing it for
 * country is its own can of worms).
 *
 * TODO(c-12): when image attachments ship and AssistantContext exposes a
 * structured country field, inspect tool input for image refs and fail
 * when `org.country === 'GB'` AND any image is tagged before/after.
 */
const noBeforeAfterImageryUkAds: HardBlockValidator = async () => ({
  pass: true,
});

/**
 * Block surgical pricing in conversational output (e.g. when Claire-Owner
 * drafts a customer-conversations reply).
 *
 * Per shared-spec §3: "Never reveals surgical pricing in conversation.
 * Applies to … doctor-led / surgical clinics." Surgical clinics quote
 * prices in person at consultation, not in DMs — this validator is the
 * defense-in-depth backstop on top of the prompt rule the model carries
 * via the `manage-customer-chats` skill.
 *
 * Behaviour:
 *   1. **Cheap pre-check.** Scan every string field on the proposed input
 *      for a price-shaped match (`£3000`, `from €X`, `priced at`, …). No
 *      match → pass without an org lookup. This makes the validator a
 *      no-op for non-pricing-related draftReply calls.
 *   2. **Business-type lookup.** If a price was matched, call
 *      `assistant/context` (path-whitelisted, owned by `getAssistantContext`)
 *      to read the org's businessType. Fail open on lookup error — a
 *      transient API blip shouldn't block a legitimate draft.
 *   3. **Surgical classification.** Conservative v3-launch list:
 *      `cosmetic_clinic` (rhinoplasty, breast augmentation, body contour)
 *      and `hair_restoration` (FUE/FUT transplant). Other clinic types
 *      (aesthetic, dermatology, dental, etc.) often quote prices in chat
 *      and aren't subject to the rule. The compliance pass (D-7) is
 *      expected to refine this list — see TODO below.
 *
 * Field-name agnostic: `draftReply` could pass the proposed text under
 * `draft`, `reply`, `message`, etc. We check every string field rather
 * than depending on a specific name.
 *
 * @see docs/plans/claire-shared-spec.md §3 (the canonical hard-blocks list)
 * @see docs/implementations/claire-briefs/window-c09-services.md (this file)
 *
 * TODO(d-7 / compliance): finalise the surgical-business classification
 * with a named compliance owner. Candidates also worth considering:
 * `dental_practice` (oral surgery), `dermatology_clinic` (mole excision),
 * `aesthetic_clinic` (when surgical procedures are offered).
 */
const SURGICAL_BUSINESS_TYPES: ReadonlySet<string> = new Set([
  'cosmetic_clinic',
  'hair_restoration',
]);

function isSurgicalBusinessType(
  businessType: string | null | undefined
): boolean {
  return (
    typeof businessType === 'string' &&
    SURGICAL_BUSINESS_TYPES.has(businessType)
  );
}

/**
 * Price-shaped patterns. Conservative — false positives here mean an
 * operator has to rephrase a draft, not that a treatment ships unsafely.
 * The patterns deliberately match common ways pricing is referenced in
 * customer chats; a clinic that wants to invite pricing discussion in
 * person should phrase replies as "let's chat in person" or similar.
 */
const SURGICAL_PRICING_PATTERNS: readonly RegExp[] = [
  // Currency symbol immediately followed by digits (£3000, €1,500, $ 4500).
  // Captures the whole numeric run so the error message echoes the full
  // amount (the test asserts "£3000" appears verbatim in `matched`).
  /[€£$]\s*\d[\d,.]*/,
  // Digits followed by currency word/symbol (3000 EUR, 1500GBP, 99 dollars).
  /\b\d[\d,.]*\s*(?:€|£|\$|EUR|GBP|USD|euros?|pounds?|dollars?)\b/i,
  // "from £X" / "starting from $X" — common surgical-clinic phrasing.
  /\b(?:from|starting\s+(?:from|at))\s+[€£$]?\s*\d[\d,.]*/i,
  // Verbal price indicators paired with numbers ("priced at 3000",
  // "costs €99", "charge €100").
  /\b(?:priced?|costs?|charge[ds]?)\s+(?:at\s+)?[€£$]?\s*\d[\d,.]*/i,
  // Unit-price phrasings — "£X each", "€X per session".
  /[€£$]\d[\d,.]*\s*(?:each|per|a\b)/i,
];

interface AssistantContextLookup {
  businessType?: string;
}

const noSurgicalPricingInChat: HardBlockValidator = async (input, ctx) => {
  if (!input || typeof input !== 'object') return { pass: true };
  const obj = input as Record<string, unknown>;

  // Step 1 — find the first price-shaped match across any string field.
  let priceHit: { field: string; matched: string } | null = null;
  for (const [field, value] of Object.entries(obj)) {
    if (typeof value !== 'string' || value.length === 0) continue;
    for (const re of SURGICAL_PRICING_PATTERNS) {
      const match = value.match(re);
      if (match) {
        priceHit = { field, matched: match[0] };
        break;
      }
    }
    if (priceHit) break;
  }
  if (!priceHit) return { pass: true };

  // Step 2 — only now do we look up the business type. Fail open on any
  // fetch error: the prompt rule plus C-09's own draftReply guidance carry
  // the front-line defence.
  let context: AssistantContextLookup;
  try {
    context = await ctx.apiFetch<AssistantContextLookup>('assistant/context');
  } catch {
    return { pass: true };
  }

  // Step 3 — only fail when the org is in the surgical classification.
  if (!isSurgicalBusinessType(context.businessType)) return { pass: true };

  return {
    pass: false,
    code: 'noSurgicalPricingInChat',
    message: `Surgical clinics don't quote prices in chat — they're discussed in person at consultation. Field "${priceHit.field}" contains a price reference ("${priceHit.matched}"). Rephrase to invite the customer in for a consultation, or to ring the clinic for pricing.`,
  };
};

/**
 * Block fabricated result claims in ad copy or post copy. REAL
 * implementation — delegates to the D2b regex validator that already ships
 * for recommendation generation
 * (`packages/features/src/assistant/services/generate-recommendation-payload/d2b-validator.ts`).
 *
 * Walks all string fields on the proposed tool input. Catches:
 *   - banned phrases (cure, proven, best, miracle, …)
 *   - outcome claims with numbers ("60% reduction", "3x improvement")
 *   - unconditional percent claims ("30% off")
 *
 * The d2b validator also covers POM brands; we explicitly drop those here
 * because POM detection is owned by `noPomBrandNamesInAdCopy` (defense in
 * depth, separate ownership). Keeping the two split means the POM list can
 * grow without churning `noFabricatedResultClaims` semantics.
 */
const noFabricatedResultClaims: HardBlockValidator = async (input) => {
  if (!input || typeof input !== 'object') return { pass: true };
  const failures = validateGeneratedCopy(
    input as Record<string, unknown>
  ).filter((f) => f.reason !== 'pom_brand');
  if (failures.length === 0) return { pass: true };
  const first = failures[0];
  if (!first) return { pass: true };
  const matched = first.matched ? ` ("${first.matched}")` : '';
  return {
    pass: false,
    code: 'noFabricatedResultClaims',
    message: `Result claims must be conservative. Field "${first.field}" contains a flagged ${first.reason.replace('_', ' ')}${matched}. Rephrase without absolute outcomes, percent claims, or banned superlatives.`,
  };
};

/**
 * Block discounts that price below cost (createOffer / extendOffer).
 *
 * Two-tier implementation:
 *
 *   1. **Sanity-check tier (this code).** `organizationService` doesn't yet
 *      expose a `costCents` column, so a real (sale-price ≥ cost) check
 *      isn't possible. Instead we block at a threshold where it becomes
 *      implausible to cover service costs at all:
 *        - Percentage discounts ≥ 90%: at this depth, even a generously
 *          priced service can't cover consumables (injectables, product-of-
 *          sale) plus practitioner time.
 *        - Price discounts where the offer price is ≤ 10% of the original
 *          (same reasoning applied to the absolute-price variant).
 *      The thresholds are intentionally conservative: the validator only
 *      catches obviously-broken offers (e.g. typo'd 95% off) and leaves the
 *      narrower "this is below cost" judgement to the real-cost tier.
 *
 *   2. **Real-cost tier (deferred — TODO).** When `organizationService`
 *      gains a `costCents` field (or a sibling cost-per-service table), the
 *      validator should:
 *        - Resolve the offer's `serviceIds` (or `offerId` for extend) to
 *          their cost figures via a features service.
 *        - Compare the proposed `offerPriceCents` (or implied price for the
 *          percentage variant) against the sum of those costs.
 *        - Fail when discounted price < total cost.
 *      That tier can subsume the sanity-check tier, or stay layered.
 *
 * Inputs supported:
 *   - createOffer first call: `{ type, originalPriceCents, offerPriceCents,
 *     discountPercent }`. We inspect the relevant fields based on `type`.
 *   - extendOffer first call: `{ offerId, newValidUntil }` — pass-through
 *     for now (no discount change). Real-cost tier may want to re-validate
 *     against the current offer's pricing if the offer has been edited
 *     since creation.
 *
 * Defense-in-depth posture: the prompt also tells the model to refuse deep
 * discounts on injectables; this validator backstops cases where the model
 * still proposes one.
 *
 * @see docs/plans/claire-shared-spec.md §3 (cost-related hard block)
 * @see docs/implementations/claire-briefs/track-c08.md §Step 3
 *
 * TODO(c-08-followup): once a per-service cost field ships, swap this for a
 * cost-aware comparison that uses the offer's resolved services.
 */
const SEVERE_PERCENT_DISCOUNT_THRESHOLD = 90;
const SEVERE_PRICE_RATIO_THRESHOLD = 0.1;

const noDiscountBelowCost: HardBlockValidator = async (input) => {
  if (!input || typeof input !== 'object') return { pass: true };
  const obj = input as Record<string, unknown>;

  // Percentage variant — fail when the proposed percent crosses the severe
  // threshold (90%+). At that depth, even a generously-priced service can't
  // cover the cost of consumables + practitioner time.
  const discountPercent = obj.discountPercent;
  if (
    typeof discountPercent === 'number' &&
    Number.isFinite(discountPercent) &&
    discountPercent >= SEVERE_PERCENT_DISCOUNT_THRESHOLD
  ) {
    return {
      pass: false,
      code: 'noDiscountBelowCost',
      message: `A ${discountPercent}% discount is likely below service cost — aesthetic treatments typically have 30–40% cost-of-goods alone. Suggest a discount below 50%, or ask the operator to confirm this is intentional.`,
    };
  }

  // Price-discount variant — fail when offerPriceCents drops to ≤10% of
  // originalPriceCents. Same reasoning as above: a near-free treatment
  // can't cover its own costs.
  const original = obj.originalPriceCents;
  const sale = obj.offerPriceCents;
  if (
    typeof original === 'number' &&
    typeof sale === 'number' &&
    Number.isFinite(original) &&
    Number.isFinite(sale) &&
    original > 0 &&
    sale >= 0 &&
    sale <= original * SEVERE_PRICE_RATIO_THRESHOLD
  ) {
    const discountedPercent = Math.round(((original - sale) / original) * 100);
    return {
      pass: false,
      code: 'noDiscountBelowCost',
      message: `Selling at €${(sale / 100).toFixed(2)} when the standard price is €${(original / 100).toFixed(2)} is a ${discountedPercent}% discount — that's likely below service cost for an aesthetic treatment. Suggest a discount that keeps the price above 50% of the standard rate.`,
    };
  }

  return { pass: true };
};

/**
 * Block service-pivot recommendations before the org reaches Stage 2
 * (per the 21-day stage transition in the shared spec §5).
 *
 * STUB — `AssistantContext` doesn't surface a computed `stage` value.
 * The shared spec defines stages by 21/30/60-day transitions but no service
 * exposes the current stage of the org. We can't cleanly compute it from
 * `org.createdAt` here without bringing the calc into the validator
 * (which would duplicate any future stage-derivation logic and surface
 * uncertainty about timezone / cohort handling).
 *
 * TODO(c-13): when knowledge-base operational snapshots ship, expose a
 * `stage: 'stage1' | 'stage2' | 'stage3'` field on `AssistantContext`
 * (or a sibling helper) and gate this validator on it.
 */
const noServicePivotBeforeStage2: HardBlockValidator = async () => ({
  pass: true,
});

/**
 * Block ads/offers built against a service the Claire-engine has marked as
 * `switch_service` or `do_not_advertise`.
 *
 * The engine ranks services on three axes (retentionModel, commitmentLevel,
 * marketPosition) and emits an `offerStrategy` per ranked service:
 *   - `switch_service` — owner price is above local market; advertise rank-2.
 *   - `do_not_advertise` — cold-traffic doesn't fit this service.
 *
 * Either value is the engine's hard "no" on this service for cold-traffic
 * ads/offers. The prompt instructs Claire to call `getAlternativeRecommendation`,
 * but a model still sometimes plows ahead. This validator is the backstop.
 *
 * Behaviour:
 *   1. Read `serviceId` (or first id from `serviceIds[]`) off the proposed
 *      input. No id → pass (validator not applicable, e.g. tools that don't
 *      carry a service).
 *   2. Look up the org's current ad-creation context. The top pick comes back
 *      with full `offer.strategy`. If the proposed service IS the top pick
 *      AND its strategy is one of the refusal values → fail.
 *   3. Lookup failures fail open (a transient API blip shouldn't block a
 *      legitimate flow). The prompt rule remains in place.
 *
 * Out of scope (alternatives endpoint returns slim shape without strategy):
 *   - Alternatives whose strategy is also `switch_service` / `do_not_advertise`
 *     pass through this validator. The engine's ranking already filters
 *     hard-refusal services off the top.
 *
 * @see packages/features/src/claire/services/get-ad-creation-context/
 */
interface AdCreationContextLookup {
  service: {
    serviceId: string;
    offer?: { strategy?: string };
  } | null;
}

const REFUSAL_STRATEGIES: ReadonlySet<string> = new Set([
  'switch_service',
  'do_not_advertise',
]);

function readServiceId(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  if (typeof obj.serviceId === 'string' && obj.serviceId.length > 0) {
    return obj.serviceId;
  }
  if (Array.isArray(obj.serviceIds)) {
    const first = obj.serviceIds.find(
      (v): v is string => typeof v === 'string' && v.length > 0
    );
    if (first) return first;
  }
  return null;
}

const noAdForRefusedService: HardBlockValidator = async (input, ctx) => {
  const serviceId = readServiceId(input);
  if (!serviceId) return { pass: true };

  let context: AdCreationContextLookup;
  try {
    context = await ctx.apiFetch<AdCreationContextLookup>(
      'claire/ad-creation-context'
    );
  } catch {
    return { pass: true };
  }

  const top = context.service;
  if (!top || top.serviceId !== serviceId) return { pass: true };
  const strategy = top.offer?.strategy;
  if (typeof strategy !== 'string' || !REFUSAL_STRATEGIES.has(strategy)) {
    return { pass: true };
  }

  const reason =
    strategy === 'switch_service'
      ? "the org's price for this service is above local market — advertising at this price won't convert. Call `getAlternativeRecommendation` and use rank 2 instead."
      : "cold-traffic isn't the right channel for this service. Recommend retargeting an existing warm audience instead.";

  return {
    pass: false,
    code: 'noAdForRefusedService',
    message: `The Claire-engine has refused this service for cold-traffic advertising (offerStrategy: ${strategy}) — ${reason}`,
  };
};

/**
 * Read EVERY service id off the proposed input — both a scalar `serviceId`
 * and each string in a `serviceIds[]`. Companion to `readServiceId` (which
 * returns only the first, for the refused-service check); the grounding check
 * must validate all of them, since one fabricated id in a multi-service ad is
 * still a fabricated ad.
 */
function readServiceIds(input: unknown): string[] {
  if (!input || typeof input !== 'object') return [];
  const obj = input as Record<string, unknown>;
  const ids: string[] = [];
  if (typeof obj.serviceId === 'string' && obj.serviceId.length > 0) {
    ids.push(obj.serviceId);
  }
  if (Array.isArray(obj.serviceIds)) {
    for (const v of obj.serviceIds) {
      if (typeof v === 'string' && v.length > 0) ids.push(v);
    }
  }
  return ids;
}

/**
 * Block ads/campaigns/offers bound to a service that isn't in the org's real
 * catalogue — the anti-hallucination backstop.
 *
 * The orchestrator injects the org's services as a plain comma-joined name
 * list (Block 4) with no hard grounding, and the authoritative catalogue is
 * only reachable via the OPTIONAL `context_listServices` tool. So a model can
 * invent a service or feature and bind a fabricated `serviceId` into
 * `createDraftAd` — which pre-mints a `launch_ad` confirmation token — leaving
 * an ad for a service the business doesn't offer one confirm away from spend.
 *
 * This validator is the server-side guarantee behind the persona's "I won't
 * invent a service" rule (defense in depth, exactly the posture this module's
 * header describes). It runs at the bind sites where a serviceId enters a
 * money path (createDraftAd today) and refuses any id not in the live
 * catalogue.
 *
 * Behaviour:
 *   1. Read every `serviceId` / `serviceIds[]` off the input. None → pass
 *      (validator not applicable — most tools carry no service).
 *   2. Fetch the org's real catalogue via `fetchServiceCatalogue`, which pages
 *      `GET organization-services` (globally whitelisted) to exhaustion, and
 *      build the set of real ids.
 *   3. Any proposed id not in that set → fail, naming the offending id(s) and
 *      steering the model back to `listServices`.
 *   4. Lookup failure → fail OPEN. Note this deliberately differs from the
 *      learning-phase validators, which now fail CLOSED on an unverifiable
 *      lookup (register #82/#94). The difference is whether an authoritative
 *      check survives downstream. There, nothing else catches a change that
 *      would reset a live campaign's learning, so the change is held. Here,
 *      `createAd` re-validates every serviceId against the org before it
 *      writes anything (`create-ad.service.ts`) — a fabricated id still cannot
 *      produce a draft. So blocking on a services-endpoint blip would only
 *      stop legitimate ads while adding no safety.
 *   5. Catalogue INCOMPLETE (page cap hit) → also fail open. This validator
 *      reasons from absence, so a partial catalogue cannot distinguish "not
 *      offered" from "not fetched", and guessing there would block a real ad.
 */
const noHallucinatedService: HardBlockValidator = async (input, ctx) => {
  const serviceIds = readServiceIds(input);
  if (serviceIds.length === 0) return { pass: true };

  let realIds: Set<string>;
  try {
    const catalogue = await fetchServiceCatalogue(ctx.apiFetch);
    if (!catalogue.complete) return { pass: true };
    realIds = new Set(catalogue.items.map((s) => s.id));
  } catch {
    return { pass: true };
  }

  const unknown = serviceIds.filter((id) => !realIds.has(id));
  if (unknown.length === 0) return { pass: true };

  const label = unknown.length > 1 ? 'ids' : 'id';
  const verb = unknown.length > 1 ? 'are' : 'is';
  const quoted = unknown.map((id) => `"${id}"`).join(', ');
  return {
    pass: false,
    code: 'noHallucinatedService',
    message: `Service ${label} ${quoted} ${verb} not in this business's service catalogue. Never invent a service or feature — call listServices, pick a real service id from what it returns, and build around that. If the treatment genuinely isn't on their books yet, tell the owner it needs adding in Settings before I can advertise it.`,
  };
};

// ---------------------------------------------------------------------------
// Library + runner
// ---------------------------------------------------------------------------

/**
 * Named validator dictionary. Skills reference these names by string in
 * their `hardBlocks` array; the runner dispatches by name lookup.
 *
 * Adding a new validator: implement above, add the entry here, document
 * which skills (or skill bundle) declare it. The skill-resolution test in
 * `packages/features/src/assistant/skills/skills.test.ts` keeps the two
 * sides in lock-step.
 */
export const hardBlockValidators = {
  noLiveCampaignChangeDuringLearningPhase,
  noScalingBeforeLearningExits,
  noPomBrandNamesInAdCopy,
  noBeforeAfterImageryUkAds,
  noSurgicalPricingInChat,
  noFabricatedResultClaims,
  noDiscountBelowCost,
  noServicePivotBeforeStage2,
  noAdForRefusedService,
  noHallucinatedService,
} as const satisfies Record<string, HardBlockValidator>;

export type HardBlockValidatorName = keyof typeof hardBlockValidators;

/**
 * Run a list of named validators against the proposed tool input. Behaviour:
 *   - Empty `names` → `{ pass: true }`.
 *   - Unknown validator name → returned as a failure with code
 *     `UNKNOWN_HARD_BLOCK`. (We do NOT silently treat unknown names as a
 *     pass; a typo in a skill's hardBlocks would otherwise be invisible.)
 *   - All validators run in parallel via `Promise.all`. The runner returns
 *     the FIRST failure (in declared order) or `{ pass: true }` if every
 *     validator passes.
 *
 * The factory wires this as the default `ctx.runHardBlocks` in
 * `tool-context.ts` — tests can pass a deterministic alternative via
 * `BuildToolsContextInput.runHardBlocks` to avoid touching real validators.
 */
export const runHardBlockValidators: HardBlockRunner = async (
  names,
  input,
  ctx
) => {
  if (names.length === 0) return { pass: true };

  const results = await Promise.all(
    names.map(async (name): Promise<HardBlockResult> => {
      const validator =
        hardBlockValidators[name as HardBlockValidatorName] ?? null;
      if (!validator) {
        return {
          pass: false,
          code: 'UNKNOWN_HARD_BLOCK',
          message: `Unknown hard-block validator: "${name}". Check the skill's hardBlocks list against \`hardBlockValidators\` in apps/api/src/assistant/tool-factory/hard-blocks.ts.`,
        };
      }
      return validator(input, ctx);
    })
  );

  for (const result of results) {
    if (!result.pass) return result;
  }
  return { pass: true };
};
