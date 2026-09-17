import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import { createLogger } from '@borradh-workspace/observability';
import { z } from 'zod';
import { validateGeneratedCopy } from '../../../assistant/services/generate-recommendation-payload/d2b-validator.js';
import type { RenderOfferCopyInput, RenderServiceCopyInput } from '../types.js';
import { extractPriceCents, taxonomiseService } from './service-taxonomy.js';

const logger = createLogger('AestheticClinicRenderCopy');

const MAX_TOKENS = 350;
const MAX_ATTEMPTS = 2;

const copyResponseSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(500),
});

type Copy = z.infer<typeof copyResponseSchema>;

const SYSTEM_PROMPT = `You are Claire, a warm but direct Irish marketing assistant helping aesthetic clinic owners.

Output JSON only — { "title": "≤ 200 chars", "body": "≤ 500 chars — 1-2 sentences" }.

Compliance — never violate:
- No percentage claims (e.g. "30% off", "up to 60% reduction").
- No outcome claims with numbers (e.g. "3x smoother").
- No absolute guarantees ("guaranteed", "proven", "cure", "best", "most effective", "miracle", "permanent").
- Never name a POM brand (Botox, Aqualyx, Lemon Bottle, Kybella, Juvederm, Azzalure, Dysport, Bocouture).

Tone: Irish, name-first, concise. No emojis. No "just" as a softener. Tell the owner what to do and why.`;

const ensureClient = (): boolean => {
  if (isAIClientInitialized()) return true;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return false;
  initAIClient({ apiKey: key });
  return true;
};

const tryGenerate = async (
  userPrompt: string,
  staticFallback: Copy
): Promise<Copy> => {
  if (!ensureClient()) {
    logger.warn('OPENAI_API_KEY not set; using static fallback copy');
    return staticFallback;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await chatCompletion(userPrompt, {
        maxTokens: MAX_TOKENS,
        temperature: 0.7,
        systemMessage: SYSTEM_PROMPT,
        jsonResponse: true,
      });

      if (!response.content) {
        logger.warn('Copy LLM returned empty content', { attempt });
        continue;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(response.content);
      } catch {
        logger.warn('Copy LLM returned non-JSON', { attempt });
        continue;
      }

      const parsed = copyResponseSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn('Copy LLM failed schema check', { attempt });
        continue;
      }

      const failures = validateGeneratedCopy(parsed.data);
      if (failures.length > 0) {
        logger.warn('Copy LLM tripped d2b validator', {
          attempt,
          failures,
        });
        continue;
      }

      return parsed.data;
    } catch (error) {
      logger.warn('Copy LLM call threw', {
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return staticFallback;
};

const formatPrice = (cents: number): string => {
  const euros = cents / 100;
  return Number.isInteger(euros) ? `€${euros}` : `€${euros.toFixed(2)}`;
};

// ============================================================================
// Outcome-based titling (A3)
// ============================================================================
//
// Spec: title services by what they SOLVE, not the literal menu name. Most
// visible for generic "facial" entries — "brighten & clear facial" reads far
// better than "facial" / "signature facial". The literal `service.name` stays
// available everywhere; this only changes the *displayed title*.

// Outcome label keyed off the service's canonical taxonomy category. Keep these
// outcome-led ("what it fixes"), compliance-safe (no numbers, no guarantees).
const OUTCOME_TITLE_BY_CANONICAL: Record<string, string> = {
  facial: 'Brighten & Clear Facial',
  microneedling: 'Skin-Renewal Microneedling',
  peel: 'Brightening Skin Peel',
  skin_boosters: 'Hydration & Glow Boost',
  hydrafacial: 'Deep-Clean Glow Facial',
  laser: 'Smooth-Skin Laser',
  head_spa: 'De-Stress Head Spa',
  massage: 'Relax & Restore Massage',
  brows: 'Brow Shape & Define',
  lashes: 'Lash Lift & Define',
  manicure: 'Polished Hands Treatment',
  cavitation: 'Body-Contour Treatment',
  rf_skin_tightening: 'Skin-Tightening Treatment',
  cryolipolysis: 'Fat-Reduction Treatment',
  ems_body: 'Muscle-Tone Body Treatment',
};

// Heuristic refinement for facials: if the literal name signals an explicit
// problem (acne, pigment, ageing), title by that problem so the outcome is
// specific rather than generic.
const FACIAL_OUTCOME_OVERRIDES: Array<{ keywords: string[]; title: string }> = [
  {
    keywords: ['acne', 'congest', 'blemish', 'spot'],
    title: 'Clear-Skin Facial',
  },
  {
    keywords: ['pigment', 'brighten', 'glow', 'dull'],
    title: 'Brighten & Clear Facial',
  },
  {
    keywords: ['anti-age', 'anti age', 'ageing', 'aging', 'firming', 'lift'],
    title: 'Anti-Ageing Facial',
  },
  {
    keywords: ['hydra', 'hydrating', 'moisture'],
    title: 'Deep-Hydration Facial',
  },
];

/**
 * Map a service to an outcome-led display title. Falls back to the literal
 * service name for unrecognised treatments so nothing is ever blank.
 */
export const deriveOutcomeTitle = (service: { name: string }): string => {
  const entry = taxonomiseService(service);
  const lowerName = ` ${service.name.toLowerCase().trim()} `;

  if (entry.canonical === 'facial') {
    for (const override of FACIAL_OUTCOME_OVERRIDES) {
      if (override.keywords.some((kw) => lowerName.includes(kw))) {
        return override.title;
      }
    }
  }

  return OUTCOME_TITLE_BY_CANONICAL[entry.canonical] ?? service.name;
};

// ============================================================================
// Service copy
// ============================================================================

const buildServiceUserPrompt = (input: RenderServiceCopyInput): string => {
  const entry = taxonomiseService(input.service);
  const outcomeTitle = deriveOutcomeTitle(input.service);
  return `Clinic: ${input.organizationName}.

Recommend why "${input.service.name}" should be their cold-traffic ad.

Service info:
- Canonical category: ${entry.canonical}
- Outcome-led title (name this by what it SOLVES, e.g. "${outcomeTitle}" — not the literal menu name): ${outcomeTitle}
- Cadence: ${entry.cadence}
- First-trust-builder: ${entry.isFirstTrustBuilder}
- Premium upgrade: ${entry.isPremiumUpgrade}
- Pricing: ${input.service.priceText ?? 'not provided'}

Clinic axes:
- retentionModel: ${input.axes.retentionModel}
- commitmentLevel: ${input.axes.commitmentLevel}
- marketPosition: ${input.axes.marketPosition}

Engine scores (0-1):
- retentionFit: ${input.ranked.criteriaScores.retentionFit.toFixed(2)}
- barrierToEntry: ${input.ranked.criteriaScores.barrierToEntry.toFixed(2)}
- crossSell: ${input.ranked.criteriaScores.crossSell.toFixed(2)}
- complianceRisk: ${input.ranked.criteriaScores.complianceRisk.toFixed(2)}

Return JSON:
- title: short imperative naming the treatment by what it SOLVES (use the outcome-led title above), e.g. "Run a Brighten & Clear Facial first" (≤ 60 chars feels best).
- body: 1-2 sentences. State WHY this service (short rebooking cycle, low barrier, compliance-safe, gateway to other treatments). No percentages, no outcome numbers, no POM brand names.`;
};

// Deterministic, sync, NO-LLM service copy. Used as the LLM fallback inside
// `renderServiceCopy` AND directly by the live ranking path (recomputeRanking)
// for any service whose copy isn't cached on the profile.
export const staticServiceCopy = (input: RenderServiceCopyInput): Copy => {
  const outcomeTitle = deriveOutcomeTitle(input.service);
  return {
    title: `Run ${outcomeTitle} first`,
    body: `${input.service.name} fits your menu and your owner profile — it's the cleanest entry-point treatment to put in front of a cold audience. Once new clients trust you with this, the rest of your menu becomes easier to sell.`,
  };
};

export const renderServiceCopy = async (
  input: RenderServiceCopyInput
): Promise<Copy> =>
  tryGenerate(buildServiceUserPrompt(input), staticServiceCopy(input));

// ============================================================================
// Offer copy
// ============================================================================

const buildOfferUserPrompt = (input: RenderOfferCopyInput): string => {
  const introPriceLine =
    input.offerStrategy.suggestedIntroPrice !== undefined
      ? `- Suggested intro price: ${formatPrice(
          input.offerStrategy.suggestedIntroPrice
        )}`
      : '- Suggested intro price: (none — strategy is price-hidden)';

  const currentPriceCents = extractPriceCents(input.service);
  const currentPriceLine =
    currentPriceCents !== undefined
      ? `- Regular price (extracted from pricing description): ${formatPrice(
          currentPriceCents
        )}`
      : '- Regular price: (not provided)';

  return `Clinic: ${input.organizationName}.

Write the offer recommendation for service "${input.service.name}".

Strategy: ${input.offerStrategy.strategy}
Strategy reason: ${input.offerStrategy.reason}
${introPriceLine}
${currentPriceLine}

Clinic axes:
- retentionModel: ${input.axes.retentionModel}
- commitmentLevel: ${input.axes.commitmentLevel}
- marketPosition: ${input.axes.marketPosition}

Return JSON:
- title: short, specific. If the strategy is price_visible_intro and a price is suggested, include the price in the title (e.g. "€125 intro pricing"). Otherwise something like "Consultation-led" or "Keep price off the ad".
- body: 1-2 sentences. Explain the offer mechanic. Anchor it to CAC where relevant ("This is your customer acquisition cost; every rebook is profit"). No percentages, no outcome numbers, no POM brand names. Don't quote any number outside the suggested price.`;
};

// Deterministic, sync, NO-LLM offer copy. Used as the LLM fallback inside
// `renderOfferCopy` AND directly by the live ranking path for un-cached copy.
export const staticOfferCopy = (input: RenderOfferCopyInput): Copy => {
  const strategy = input.offerStrategy.strategy;
  const introPrice = input.offerStrategy.suggestedIntroPrice;
  switch (strategy) {
    case 'price_visible_intro':
      return {
        title:
          introPrice !== undefined
            ? `${formatPrice(introPrice)} intro pricing`
            : 'Intro pricing',
        body: 'First-visit only. Your regular price stays the same. Think of this as your customer acquisition cost — every rebook after the first visit is profit on the marketing spend.',
      };
    case 'consultation_led':
      return {
        title: 'Consultation-led',
        body: 'Lead with a consultation, not a price. Surgical and major procedures convert on trust and credentials, not on a number in the ad.',
      };
    case 'price_hidden_conversation':
      return {
        title: 'Keep price off the ad',
        body: 'Pricing stays out of the cold ad. Qualify and quote in DM so you can frame the value before the number lands.',
      };
    case 'switch_service':
      return {
        title: 'Switch the offer service',
        body: 'This service is not the right cold-traffic offer — Claire will route you to the next best option in your menu.',
      };
    case 'do_not_advertise':
      return {
        title: 'Hold off on cold ads',
        body: "Cold-traffic ads aren't the right fit at this price tier without an entry treatment. Retargeting recent visitors and warm audiences will return more until pricing or service mix changes.",
      };
  }
};

export const renderOfferCopy = async (
  input: RenderOfferCopyInput
): Promise<Copy> =>
  tryGenerate(buildOfferUserPrompt(input), staticOfferCopy(input));
