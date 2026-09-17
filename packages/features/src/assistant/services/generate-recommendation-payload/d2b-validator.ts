/**
 * Decision 2b regex validator — rejects medical/compliance-risky phrasing
 * in LLM-generated ad and recommendation copy.
 *
 * Applied BEFORE writing a payload to the `assistant_recommendation` row.
 * If any string field trips a rule, the generator treats this as a bad
 * generation, retries, and falls back to static copy on repeated failure.
 *
 * See docs/plans/claire-spec-v2.md Decision 2b and
 * docs/plans/claire-shared-spec.md §3 (hard blocks).
 *
 * NOTE: The blocklist is intentionally conservative. A compliance pass
 * (deferred 2c/2d) will own and maintain these lists. When you add a
 * phrase, also add a test case.
 */

const BANNED_PHRASES = [
  /\bguaranteed?\b/i,
  /\bproven\b/i,
  /\bcure\b/i,
  /\bclinically shown\b/i,
  /\bbest\b/i,
  /\bmost effective\b/i,
  /\bmiracle\b/i,
  /\bpermanent(ly)?\b/i,
];

// Numbers paired with outcome words (e.g. "60% reduction", "3x improvement").
const OUTCOME_CLAIM =
  /\d+[\d.%]*\s*(x|times)?\s*(reduction|improvement|lift|tightening|smoothing|boost|increase|decrease|loss|gain)/i;

// Any % sign paired with digits — "30% off", "up to 50%".
const PERCENT_CLAIM = /\d+\s*%/;

// POM brand names (UK/IE). Same list referenced by ad-generator — eventually
// de-duped via config when the compliance pass lands.
const POM_BRANDS = [
  /\baqualyx\b/i,
  /\blemon bottle\b/i,
  /\bkybella\b/i,
  /\bbotox\b/i,
  /\bjuvederm\b/i,
  /\bazzalure\b/i,
  /\bdysport\b/i,
  /\bbocouture\b/i,
];

export interface ValidationFailure {
  field: string;
  reason: string;
  matched?: string;
}

export function validateGeneratedCopy(
  payload: Record<string, unknown>
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  for (const [field, value] of Object.entries(payload)) {
    if (typeof value !== 'string') continue;

    if (PERCENT_CLAIM.test(value)) {
      const match = value.match(PERCENT_CLAIM);
      failures.push({
        field,
        reason: 'percent_claim',
        matched: match?.[0],
      });
    }

    if (OUTCOME_CLAIM.test(value)) {
      const match = value.match(OUTCOME_CLAIM);
      failures.push({
        field,
        reason: 'outcome_claim',
        matched: match?.[0],
      });
    }

    for (const re of BANNED_PHRASES) {
      if (re.test(value)) {
        const match = value.match(re);
        failures.push({
          field,
          reason: 'banned_phrase',
          matched: match?.[0],
        });
      }
    }

    for (const re of POM_BRANDS) {
      if (re.test(value)) {
        const match = value.match(re);
        failures.push({
          field,
          reason: 'pom_brand',
          matched: match?.[0],
        });
      }
    }
  }

  return failures;
}
