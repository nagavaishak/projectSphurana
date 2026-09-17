import type { Offer } from '@borradh-workspace/database';

/**
 * Hard-coded system prompt for the offer-copy generator.
 *
 * The output runs through the shared `d2b-validator` — banned phrases
 * ("guaranteed", "proven", percentages, outcome claims, POM brands) get
 * filtered. We tell the model these rules up-front so most outputs pass on
 * the first call.
 */
export const OFFER_COPY_SYSTEM_PROMPT = `You write video-ad copy for service-business offers (clinics, salons, gyms, etc).

Output rules — these are HARD and will be checked programmatically:
- Do NOT use percentages (no "%" sign with a number — "20% off" is forbidden).
- Do NOT make outcome claims with numbers ("3x results", "60% smoother" forbidden).
- Do NOT use the words: guaranteed, proven, cure, best, miracle, permanent, "clinically shown".
- Do NOT mention prescription-only brand names (Botox, Juvederm, Aqualyx, etc).
- Discount and pricing details get rendered separately by the video template — your job is benefit-focused copy.

Tone: confident, warm, practical. Avoid hype.

Return strict JSON with this exact shape:
{
  "headline": string,        // <= 60 chars, benefit-focused, no price/percent
  "ctaText": string,         // <= 25 chars, action phrase, e.g. "Book now"
  "urgencyText": string,     // <= 50 chars, light urgency, e.g. "Limited spots this week"
  "audienceText": string,    // <= 50 chars, who it's for, e.g. "For first-time clients"
  "bulletPoints": string[]   // 3-4 items, each <= 50 chars, specific benefits
}`;

interface BuildPromptInput {
  organizationName: string | null;
  businessType: string | null;
  offer: Pick<
    Offer,
    | 'name'
    | 'discountType'
    | 'discountPercent'
    | 'originalPriceCents'
    | 'offerPriceCents'
    | 'buyQuantity'
    | 'getQuantity'
  >;
  serviceNames: string[];
  /** Optional user instruction to steer the copy (upfront or on a re-roll). */
  refinementInstruction?: string;
  /** Previously generated copy, for refinement-aware re-rolls. */
  priorCopy?: Record<string, unknown>;
}

/**
 * Build the user prompt with offer + business context.
 */
export function buildOfferCopyUserPrompt(input: BuildPromptInput): string {
  const parts: string[] = [];

  if (input.organizationName) {
    parts.push(`Business: ${input.organizationName}`);
  }
  if (input.businessType) {
    parts.push(`Business type: ${input.businessType}`);
  }

  parts.push(`Offer name: ${input.offer.name}`);

  if (input.serviceNames.length > 0) {
    parts.push(`Service(s): ${input.serviceNames.join(', ')}`);
  }

  // Discount context — described in qualitative terms so the model can frame
  // benefit copy WITHOUT putting the literal percent/price in its output
  // (which d2b would reject).
  switch (input.offer.discountType) {
    case 'percentage':
      parts.push(
        'Discount type: percentage discount (the exact number is rendered by the video template; do NOT include it in copy).'
      );
      break;
    case 'fixed_price':
      parts.push(
        'Discount type: discounted fixed price (the prices are rendered by the video template; do NOT include numbers in copy).'
      );
      break;
    case 'buy_x_get_y':
      parts.push(
        `Discount type: buy ${input.offer.buyQuantity ?? 'X'}, get ${input.offer.getQuantity ?? 'Y'} (the exact ratio is rendered by the video template; you can hint at the freebie without quoting numbers).`
      );
      break;
  }

  // User change request — when re-rolling, anchor to the prior copy so the
  // change is applied surgically; otherwise treat it as upfront guidance.
  if (input.refinementInstruction?.trim()) {
    if (input.priorCopy) {
      parts.push(
        `\nPREVIOUS COPY (the user has already seen this — JSON): ${JSON.stringify(
          input.priorCopy
        )}\nApply the user's change and return the SAME shape with everything else kept close to the previous copy. User's change: ${input.refinementInstruction.trim()}`
      );
    } else {
      parts.push(
        `\nUser instruction (steer the copy accordingly): ${input.refinementInstruction.trim()}`
      );
    }
  }

  parts.push(
    '\nReturn a JSON object with the exact keys: headline, ctaText, urgencyText, audienceText, bulletPoints. No surrounding markdown or explanation.'
  );

  return parts.join('\n');
}
