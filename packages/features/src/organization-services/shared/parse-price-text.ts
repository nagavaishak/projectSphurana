/**
 * `parsePriceText` — the deprecation bridge from the freeform
 * `organization_service.price_text` to the structured price model
 * `(priceType, priceCents [+ variants])`. See docs/plans/service-pricing-model.md.
 *
 * Pure, no DB / Drizzle imports. Grounded in a prod audit of 1,233 priced
 * services (2026-07-15): ~67% one fixed price, ~14% "from", ~1% free, ~11%
 * junk/placeholder, ~8% genuinely multi-point. Much of the "messy middle" is
 * NOISE — a prior import concatenated price + deposit + duration
 * ("$150 with a $25.00 deposit required. Duration: 30 min" is really just $150).
 *
 * The one iron rule: **never fabricate a number or a wrong price.** `poa`
 * (price on consultation) is always the safe fallback. A wrong price is worse
 * than no price.
 */

import type { ServicePriceType } from '@borradh-workspace/labels';

export interface ParsedPriceVariant {
  name: string;
  priceCents: number;
}

export interface ParsedPrice {
  priceType: ServicePriceType;
  priceCents: number | null;
  /** Only present when ≥2 cleanly-labelled price points were extracted. */
  variants?: ParsedPriceVariant[];
}

/** Amounts below this (in whole currency units) are counts/units, not prices. */
const MIN_PRICE_UNITS = 10;

/**
 * Convert a numeric substring to cents, disambiguating thousands vs decimal
 * separators. "1,425" → 142500 (thousands), "1,25" → 125 (decimal comma),
 * "1.425" with a 3-digit tail → 142500 (thousands dot), "12.50" → 1250.
 * Mirrors the heuristic in the legacy `extractPriceCents`.
 */
const toCents = (raw: string): number | null => {
  let units: number;
  if (raw.includes(',') && !raw.includes('.')) {
    const parts = raw.split(',');
    const tail = parts[parts.length - 1];
    units =
      tail && tail.length === 3
        ? Number(parts.join(''))
        : Number(raw.replace(',', '.'));
  } else if (raw.includes('.') && !raw.includes(',')) {
    const parts = raw.split('.');
    const tail = parts[parts.length - 1];
    // "1.425" → thousands; "12.50" / "12.5" → decimal.
    units =
      parts.length > 1 && tail && tail.length === 3
        ? Number(parts.join(''))
        : Number(raw);
  } else {
    units = Number(raw.replace(/,/g, ''));
  }
  if (!Number.isFinite(units)) return null;
  return Math.round(units * 100);
};

const NUMBER = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?';
// Currency-tagged amount: symbol prefix (£/€/$) OR a euros/pounds/dollars word.
const CURRENCY_AMOUNT = new RegExp(
  `(?:[£€$]\\s?(${NUMBER}))|(?:(${NUMBER})\\s*(?:euros?|pounds?|dollars?|eur|gbp|usd)\\b)`,
  'gi'
);

interface Amount {
  cents: number;
  start: number;
  end: number;
}

/** All currency-tagged amounts ≥ MIN_PRICE_UNITS, in order of appearance. */
const findAmounts = (text: string): Amount[] => {
  const out: Amount[] = [];
  for (const m of text.matchAll(CURRENCY_AMOUNT)) {
    const raw = m[1] ?? m[2];
    if (!raw) continue;
    const cents = toCents(raw);
    if (cents === null || cents < MIN_PRICE_UNITS * 100) continue;
    out.push({ cents, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
};

/**
 * Strip NOISE that a prior import concatenated onto the real price so it never
 * reads as a second amount: deposit clauses, durations, and stray labels.
 */
const stripNoise = (text: string): string =>
  text
    // Deposit clauses. Anchor on the deposit AMOUNT so we never greedily eat a
    // price that follows ("Requires a €50 deposit — £200" keeps the £200).
    // Covers "$25.00 deposit required", "deposit of £25", bare "deposit required".
    .replace(/deposit\s+of\s+[£€$]?\s?\d[\d,.]*/gi, ' ')
    .replace(/[£€$]?\s?\d[\d,.]*\s*deposit(?:\s+required)?/gi, ' ')
    .replace(/\bdeposit\s+required\b/gi, ' ')
    // durations: "Duration: 30 min", "30 min", "1 hr", "1.5 hours"
    .replace(/\bduration\s*:?[^,.;]*/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:mins?|minutes?|hrs?|hours?)\b/gi, ' ')
    // currency-descriptor word that isn't itself a price signal
    .replace(/\bbritish\b/gi, ' ')
    // discount/save clauses: "Save up to 10%", "save 15%"
    .replace(/\bsave\s+(?:up\s+to\s+)?\d+%/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

const FREE = /\b(free|complimentary|no charge)\b/i;
/**
 * A floor rather than a fixed price. Deliberately NOT anchored to the start of
 * the string: real price_text routinely leads with a duration or service count
 * before the floor ("3 hr From €250", "30 mins • 2 services from £29.70",
 * "Introductory price starts @ $199"). Anchoring "from" to the start silently
 * typed all of those as a hard `fixed` price — a floor rendered to the customer
 * as if it were the whole cost.
 * Covers: bare "from", start/starts/starting × at/from/@, trailing "+".
 */
const FROM =
  /(\bfrom\b|\bstart(?:s|ing)?\s+(?:at|from)\b|\bstart(?:s|ing)?\s*@|\+)/i;

/** A whole-string bare number ("150") — the entire content is one amount. */
const BARE_NUMBER = /^\s*(\d+(?:\.\d{1,2})?)\s*$/;

/** Segment separators for multi-point pricing. */
const SEGMENT_SPLIT = /\s*(?:,|;|\/|\bor\b|\n)\s*/i;

/**
 * Best-effort variant extraction. Splits on separators; a segment counts as a
 * variant only when it has EXACTLY ONE amount AND a label containing a letter.
 * If any priced segment lacks a clean label, or fewer than 2 clean variants
 * survive, returns null (→ caller falls back to `poa`, never fabricating names).
 */
const extractVariants = (text: string): ParsedPriceVariant[] | null => {
  const segments = text.split(SEGMENT_SPLIT);
  const variants: ParsedPriceVariant[] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    const amounts = findAmounts(segment);
    if (amounts.length === 0) continue; // header / non-priced fragment — ignore
    if (amounts.length > 1) return null; // ambiguous segment

    const amount = amounts[0];
    if (!amount) return null;
    // Label = the segment minus the price token, minus leading/trailing
    // separators and quantity connectors.
    const label = segment
      .slice(0, amount.start)
      .concat(' ', segment.slice(amount.end))
      .replace(/[:\-–—]+/g, ' ')
      .replace(/\bfor\b|\bper\b|\bx\b/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!/[a-z]/i.test(label)) return null; // no clean label → bail
    const key = label.toLowerCase();
    if (seen.has(key)) return null; // duplicate variant name → ambiguous
    seen.add(key);
    variants.push({ name: label.slice(0, 100), priceCents: amount.cents });
  }

  return variants.length >= 2 ? variants : null;
};

/**
 * Parse a freeform price string into the structured price model.
 *
 * Order: (1) empty → poa. (2) strip noise. (3) find currency amounts.
 * (4) ≥2 distinct amounts → best-effort variants, else poa. (5) exactly one
 * amount → fixed/from. (6) no amount → free (if "free"/"complimentary") else
 * poa (covers all junk/placeholder/empty/bare-<10). A bare whole-string number
 * ≥10 with no currency is taken as a fixed price (the number IS the content).
 */
export const parsePriceText = (
  priceText: string | null | undefined
): ParsedPrice => {
  const trimmed = priceText?.trim();
  if (!trimmed) return { priceType: 'poa', priceCents: null };

  const cleaned = stripNoise(trimmed);
  const amounts = findAmounts(cleaned);
  const distinct = new Set(amounts.map((a) => a.cents));

  // ≥2 distinct amounts → genuinely multi-point. Best-effort variants.
  if (distinct.size >= 2) {
    const variants = extractVariants(cleaned);
    if (!variants) return { priceType: 'poa', priceCents: null };
    const min = Math.min(...variants.map((v) => v.priceCents));
    return { priceType: 'from', priceCents: min, variants };
  }

  // Exactly one distinct amount → fixed, or "from"/"+" → floor.
  if (distinct.size === 1) {
    const cents = amounts[0]?.cents ?? null;
    if (cents === null) return { priceType: 'poa', priceCents: null };
    return {
      priceType: FROM.test(trimmed) ? 'from' : 'fixed',
      priceCents: cents,
    };
  }

  // No currency-tagged amount. A whole-string bare number ≥10 is a price.
  const bare = BARE_NUMBER.exec(cleaned);
  if (bare?.[1]) {
    const cents = toCents(bare[1]);
    if (cents !== null && cents >= MIN_PRICE_UNITS * 100) {
      return {
        priceType: FROM.test(trimmed) ? 'from' : 'fixed',
        priceCents: cents,
      };
    }
  }

  // "Free" / "complimentary" with no price → free.
  if (FREE.test(cleaned)) return { priceType: 'free', priceCents: null };

  // Everything else — junk, placeholder, bare-<10, "?", "asdf" — is poa.
  return { priceType: 'poa', priceCents: null };
};
