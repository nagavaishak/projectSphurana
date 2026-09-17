import { organizationService } from '@borradh-workspace/database';
import { inArray } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';
import {
  type CaptionVariation,
  type TreatmentCaptions,
  masterCaptions,
} from '../../data/index.js';

export interface MatchedCaption {
  headline: string;
  /** Full assembled caption with credibility line and CTA */
  primaryText: string;
  /** The CTA type used ('consultation' or 'appointment') */
  ctaType: 'consultation' | 'appointment';
  /** Which treatment was matched */
  treatment: string;
}

/**
 * Attempt to match org services against the master captions.
 * Returns a randomly selected variation if a match is found.
 */
export async function matchCaptions(
  db: DbConnection,
  serviceIds: string[],
  credibilityLine: string | null
): Promise<MatchedCaption | null> {
  if (serviceIds.length === 0) return null;

  // Fetch service names by IDs
  const services = await db
    .select({ id: organizationService.id, name: organizationService.name })
    .from(organizationService)
    .where(inArray(organizationService.id, serviceIds));

  if (services.length === 0) return null;

  // Preserve user's selection order (DB IN queries have no guaranteed order)
  const orderedServices = serviceIds
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is (typeof services)[number] => s != null);

  // Try to find a match for any of the selected services (in user's order)
  for (const service of orderedServices) {
    const match = findTreatmentMatch(service.name);
    if (match) {
      const variation = pickRandomVariation(match.variations);
      return assembleCaption(variation, match, credibilityLine);
    }
  }

  return null;
}

/**
 * Fuzzy-match a service name against master caption treatments.
 *
 * Strategy:
 * 1. Normalize both strings (lowercase, remove special chars)
 * 2. Check if any alias is contained within the service name, or vice versa
 * 3. More specific aliases are checked first (longer = more specific)
 */
function findTreatmentMatch(serviceName: string): TreatmentCaptions | null {
  const normalized = normalize(serviceName);

  // Score each treatment by best alias match quality
  let bestMatch: TreatmentCaptions | null = null;
  let bestScore = 0;

  for (const treatment of masterCaptions) {
    for (const alias of treatment.aliases) {
      const normalizedAlias = normalize(alias);

      // Exact match gets highest score
      if (normalized === normalizedAlias) {
        return treatment;
      }

      // Check containment: service name contains alias, or
      // alias contains service name (only if service name is long enough
      // to avoid false positives like "skin" matching "skin tightening")
      if (
        normalized.includes(normalizedAlias) ||
        (normalized.length >= 4 && containsAsWord(normalizedAlias, normalized))
      ) {
        // Longer alias match = more specific = better score
        const score = normalizedAlias.length;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = treatment;
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Check if `needle` appears as a whole word (or word prefix) in `haystack`.
 * Prevents "led" matching inside "applied".
 */
function containsAsWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`);
  return regex.test(haystack);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^\w\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickRandomVariation(variations: CaptionVariation[]): CaptionVariation {
  const index = Math.floor(Math.random() * variations.length);
  return variations[index];
}

function assembleCaption(
  variation: CaptionVariation,
  treatment: TreatmentCaptions,
  credibilityLine: string | null
): MatchedCaption {
  const ctaText =
    treatment.ctaType === 'appointment'
      ? 'Send us a message to book your appointment'
      : 'Send us a message to book your consultation';

  const parts = [variation.caption];

  if (credibilityLine) {
    parts.push(`\n${credibilityLine}`);
  }

  parts.push(`\n${ctaText}`);

  return {
    headline: variation.headline,
    primaryText: parts.join('\n'),
    ctaType: treatment.ctaType,
    treatment: treatment.treatment,
  };
}
