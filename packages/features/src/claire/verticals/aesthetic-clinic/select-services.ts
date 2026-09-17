import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import { offerStrategyValues } from '@borradh-workspace/labels';
import { createLogger } from '@borradh-workspace/observability';
import { z } from 'zod';
import type { SelectServicesInput, ServiceSelection } from '../types.js';

const logger = createLogger('AestheticClinicSelectServices');

const MAX_TOKENS = 900;
const MAX_ATTEMPTS = 2;
// Keep this second phase of Claire classification inside the worker's
// end-to-end lock budget. The loop below owns the two useful attempts; adding
// the OpenAI SDK's default retries would turn each attempt into minutes of
// unbounded work during a provider incident.
const REQUEST_TIMEOUT_MS = 20_000;

const selectionSchema = z.object({
  picks: z
    .array(
      z.object({
        serviceId: z.string().min(1),
        offerStrategy: z.enum(offerStrategyValues),
        suggestedIntroPriceCents: z.number().int().positive().nullish(),
        reason: z.string().min(1).max(400),
      })
    )
    .min(1),
});

const SYSTEM_PROMPT = `You are Claire's service-selection engine for aesthetic clinics. You choose which treatments a clinic should advertise to COLD traffic on Meta, in priority order.

THE NORTH STAR — the only goal: expand the clinic's RETURNING client base. Short-term revenue is a by-product. Every pick must pass one test: does advertising this get a new client through the door who then comes back? If not, don't rank it near the top.

SELECTION HIERARCHY (general clinics — nurse, beauty therapist, body-contouring, mixed). Rank by, in order:
1. Shortest rebooking cycle — course-based treatments that bring the client back (microneedling, peels, skin boosters, laser) beat one-off / annual treatments (lip filler, anti-wrinkle).
2. Lowest barrier to entry — cheaper, lower-commitment treatments get more people through the door.
3. Cross-sell potential — a trust-building first treatment opens the rest of the menu.
The treatment that scores best across these is rank 1. There is always a pick — never refuse to advertise entirely unless the menu is ALL prescription-only.

CLINIC-TYPE OVERRIDES:
- Body-contouring clinics: lead with the body-contouring treatment with the LOWEST entry point (e.g. a small area), to get them in the door.
- Doctor / surgeon-led clinics: BREAK the hierarchy — lead with the flagship surgical/signature procedure (the thing only a surgeon does). Strategy = consultation_led (never a price).

OFFER STRATEGY per pick (use the org's market position):
- price_visible_intro: at/below market — show a first-visit intro price 30–40% below the regular one-session price. Set suggestedIntroPriceCents when you can infer the regular price from the menu (else leave it null and we'll ask).
- price_hidden_conversation: above market OR unknown market — keep price off the ad, qualify in chat.
- consultation_led: surgical / major procedures — sell the consultation, never a price.
- switch_service: this service is a poor cold-traffic lead (e.g. priced above market with a cheaper alternative in the menu) — rank the better alternative above it.
- do_not_advertise: should NOT be advertised to cold traffic.

HARD RULES:
- Prescription-only medicines (Botox, anti-wrinkle/wrinkle-relaxing injections, branded fat-dissolving like Aqualyx/Lemon Bottle/Kybella) CANNOT be advertised → offerStrategy must be do_not_advertise (or rank them last). The category can be advertised, the POM brand/treatment cannot.
- A service that does NOT solve a real, specific pain point — a generic haircut, a generic "pamper" facial, nails, a basic massage — is NOT a cold-traffic lead. Either rank it low / do_not_advertise, OR (for a generic facial) treat it as advertisable ONLY if it can be framed by what it SOLVES (acne, pigmentation, ageing). Never lead with a generic pamper service.
- "Non-surgical" treatments (non-surgical facelift, HIFU, thread lift) are NOT surgery — do not treat them as consultation_led-surgical.
- A single surgical-sounding service does NOT make a clinic surgical. Only a surgeon-owner / surgery-dominant menu does.

Return JSON ONLY: { "picks": [ { "serviceId", "offerStrategy", "suggestedIntroPriceCents" (or null), "reason" } ] }.
- Order picks BEST FIRST (rank 1 = the single best service to advertise).
- Include every service worth considering; you may omit clearly-irrelevant ones.
- serviceId MUST be copied verbatim from the menu. reason is one short sentence, compliance-safe (no % claims, no outcome numbers, no POM brand names).`;

const buildUserPrompt = (input: SelectServicesInput): string => {
  const menu = input.services
    .map((s) => {
      const price = s.priceText?.trim() || 'price not given';
      const painPoints =
        Array.isArray(s.painPoints) && s.painPoints.length > 0
          ? `; solves: ${s.painPoints.join(', ')}`
          : '';
      const desc = s.description?.trim() ? `; ${s.description.trim()}` : '';
      return `- id=${s.id} | ${s.name} (${s.category}; ${price}${painPoints}${desc})`;
    })
    .join('\n');

  return `Clinic: ${input.organizationName}.

Market position: ${input.axes.marketPosition}.
Retention model: ${input.axes.retentionModel}. Commitment level: ${input.axes.commitmentLevel}.
Owner signals: ${JSON.stringify(input.verticalMetadata ?? {})}.

Menu (use the id verbatim):
${menu}

Pick the services to advertise, best first, following the rules in the system prompt.`;
};

const ensureClient = (): boolean => {
  if (isAIClientInitialized()) return true;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return false;
  initAIClient({ apiKey: key });
  return true;
};

/**
 * LLM-first service selection. Returns the services to advertise in priority
 * order with each one's offer strategy + intro price, or `null` when the LLM
 * is unavailable / unusable (caller falls back to the keyword ranker).
 *
 * Validates returned serviceIds against the real menu and drops unknowns, so a
 * hallucinated id can never enter the ranking.
 */
export const selectServices = async (
  input: SelectServicesInput
): Promise<ServiceSelection[] | null> => {
  if (input.services.length === 0) return null;
  if (!ensureClient()) {
    logger.warn('OPENAI_API_KEY not set; falling back to keyword ranker');
    return null;
  }

  const validIds = new Set(input.services.map((s) => s.id));
  const userPrompt = buildUserPrompt(input);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await chatCompletion(userPrompt, {
        maxTokens: MAX_TOKENS,
        temperature: 0.2,
        systemMessage: SYSTEM_PROMPT,
        jsonResponse: true,
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxRetries: 0,
      });
      if (!response.content) {
        logger.warn('selectServices LLM returned empty content', { attempt });
        continue;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(response.content);
      } catch {
        logger.warn('selectServices LLM returned non-JSON', { attempt });
        continue;
      }

      const parsed = selectionSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn('selectServices output failed schema check', { attempt });
        continue;
      }

      // Keep only picks for services that actually exist; de-dupe by serviceId
      // (first occurrence wins, preserving the model's priority order).
      const seen = new Set<string>();
      const picks: ServiceSelection[] = [];
      for (const p of parsed.data.picks) {
        if (!validIds.has(p.serviceId) || seen.has(p.serviceId)) continue;
        seen.add(p.serviceId);
        picks.push({
          serviceId: p.serviceId,
          offerStrategy: p.offerStrategy,
          suggestedIntroPrice: p.suggestedIntroPriceCents ?? undefined,
          reason: p.reason,
        });
      }

      if (picks.length === 0) {
        logger.warn('selectServices produced no valid picks', { attempt });
        continue;
      }
      return picks;
    } catch (error) {
      logger.warn('selectServices LLM call threw', {
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.warn(
    'selectServices exhausted retries; falling back to keyword ranker'
  );
  return null;
};
