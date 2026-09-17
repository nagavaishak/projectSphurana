import type { Offer } from '@borradh-workspace/database';
import type { GeneratedOfferCopy } from './generate-offer-copy.schema.js';

/**
 * Templated copy used when:
 *   - OPENAI_API_KEY isn't configured, or
 *   - the LLM call fails after retries, or
 *   - the d2b-validator rejects every attempt.
 *
 * Intentionally generic — sticks to the offer name and a safe CTA so the
 * video flow always has something to render. No percentages, no outcome
 * claims, no POM brand names; passes d2b by construction.
 */
export function getOfferCopyFallback(
  offer: Pick<Offer, 'name'>,
  serviceName?: string
): GeneratedOfferCopy {
  const focus = serviceName ?? offer.name;
  return {
    headline: `New offer on ${focus}`.slice(0, 80),
    ctaText: 'Book now',
    urgencyText: 'Limited spots available',
    audienceText: 'Open to new clients',
    bulletPoints: [
      'Tailored to your goals',
      'Friendly, expert team',
      'Easy to book online',
    ],
  };
}
