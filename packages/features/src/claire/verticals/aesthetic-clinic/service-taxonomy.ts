import type { OrganizationService } from '@borradh-workspace/database';

export type ServiceCadence =
  | 'course_based' // 3+ sessions, frequent rebook
  | 'rebooking' // single treatment, scheduled return
  | 'impulse' // walk-in / monthly
  | 'consideration_sale' // surgical / major
  | 'unknown';

export type ServiceTaxonomyEntry = {
  canonical: string;
  cadence: ServiceCadence;
  isPOM: boolean;
  isOutcomeClaimHeavy: boolean;
  isFirstTrustBuilder: boolean;
  isPremiumUpgrade: boolean;
  isSurgical: boolean;
};

// Each entry is a list of substrings to match against the lowercased service
// name. The first matching entry wins.
type TaxonomyMatcher = ServiceTaxonomyEntry & { keywords: string[] };

const TAXONOMY: TaxonomyMatcher[] = [
  // ── POM / prescription-only — cannot advertise, deprioritised ────────
  {
    canonical: 'botox',
    cadence: 'rebooking',
    isPOM: true,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: false,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: ['botox', 'azzalure', 'dysport', 'bocouture'],
  },
  {
    canonical: 'anti_wrinkle',
    cadence: 'rebooking',
    isPOM: true,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: false,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: ['anti-wrinkle', 'anti wrinkle', 'antiwrinkle', 'wrinkle relax'],
  },
  {
    canonical: 'fat_dissolving',
    cadence: 'course_based',
    isPOM: true,
    isOutcomeClaimHeavy: true,
    isFirstTrustBuilder: false,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: [
      'fat dissolving',
      'fat dissolve',
      'aqualyx',
      'lemon bottle',
      'kybella',
    ],
  },
  // ── Non-surgical "lift" treatments (must precede the surgical matcher) ─
  // "Non-Surgical Facelift", HIFU, liquid/thread face lifts etc. contain the
  // substring "facelift"/"lift" but are skin-tightening treatments, NOT
  // surgery. They sit BEFORE the surgical entry so first-match-wins catches
  // them here. Course-based (HIFU/RF want a course or annual top-ups) and
  // mid-to-high ticket — never a cheap door-opener, never a surgical flag.
  {
    canonical: 'non_surgical_lift',
    cadence: 'course_based',
    isPOM: false,
    isOutcomeClaimHeavy: true,
    isFirstTrustBuilder: false,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: [
      'non-surgical facelift',
      'non surgical facelift',
      'nonsurgical facelift',
      'non-surgical face lift',
      'non surgical face lift',
      'non-surgical lift',
      'non surgical lift',
      'hifu',
      'liquid facelift',
      '8 point lift',
      '8-point lift',
    ],
  },
  // ── Surgical / consideration sale ────────────────────────────────────
  {
    canonical: 'surgical',
    cadence: 'consideration_sale',
    isPOM: false,
    isOutcomeClaimHeavy: true,
    isFirstTrustBuilder: false,
    isPremiumUpgrade: false,
    isSurgical: true,
    keywords: [
      'rhinoplasty',
      'liposuction',
      'blepharoplasty',
      'breast aug',
      'breast lift',
      'breast reduction',
      'tummy tuck',
      'abdominoplasty',
      'facelift',
      'mommy makeover',
      'body lift',
      'gynaecomastia',
      'mastopexy',
    ],
  },
  // ── Single-treatment rebooking (non-POM injectables) ─────────────────
  {
    canonical: 'filler',
    cadence: 'rebooking',
    isPOM: false,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: false,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: [
      'lip filler',
      'cheek filler',
      'jaw filler',
      'chin filler',
      'tear trough',
      'dermal filler',
      'filler',
    ],
  },
  {
    canonical: 'polynucleotides',
    cadence: 'rebooking',
    isPOM: false,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: false,
    isPremiumUpgrade: true,
    isSurgical: false,
    keywords: ['polynucleotide', 'plinest', 'nucleofill'],
  },
  {
    canonical: 'threads',
    cadence: 'rebooking',
    isPOM: false,
    isOutcomeClaimHeavy: true,
    isFirstTrustBuilder: false,
    isPremiumUpgrade: true,
    isSurgical: false,
    keywords: ['thread lift', 'pdo thread', 'threads'],
  },
  {
    canonical: 'profhilo',
    cadence: 'rebooking',
    isPOM: false,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: false,
    isPremiumUpgrade: true,
    isSurgical: false,
    keywords: ['profhilo', 'sunekos', 'sculptra'],
  },
  // ── Course-based trust builders ──────────────────────────────────────
  {
    canonical: 'microneedling',
    cadence: 'course_based',
    isPOM: false,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: true,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: [
      'microneedling',
      'micro needling',
      'micro-needling',
      'dermapen',
      'derma pen',
      'dermaroller',
      'derma roller',
      'skin pen',
      'skinpen',
      'rf microneedling',
      'collagen induction',
    ],
  },
  {
    canonical: 'peel',
    cadence: 'course_based',
    isPOM: false,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: true,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: ['chemical peel', ' peel', 'tca peel', 'cosmelan'],
  },
  {
    canonical: 'skin_boosters',
    cadence: 'course_based',
    isPOM: false,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: true,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: ['skin booster', 'skinbooster', 'mesotherapy'],
  },
  {
    canonical: 'laser',
    cadence: 'course_based',
    isPOM: false,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: true,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: [
      'laser hair removal',
      'ipl',
      'laser resurfacing',
      'co2 laser',
      'laser',
    ],
  },
  {
    canonical: 'hydrafacial',
    cadence: 'course_based',
    isPOM: false,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: true,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: ['hydrafacial', 'hydrodermabrasion', 'hydra facial'],
  },
  // ── Body contouring (non-POM modalities) ─────────────────────────────
  {
    canonical: 'cavitation',
    cadence: 'course_based',
    isPOM: false,
    isOutcomeClaimHeavy: true,
    isFirstTrustBuilder: false,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: ['cavitation', 'ultrasonic cavitation'],
  },
  {
    canonical: 'rf_skin_tightening',
    cadence: 'course_based',
    isPOM: false,
    isOutcomeClaimHeavy: true,
    isFirstTrustBuilder: false,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: [
      'rf skin',
      'radiofrequency',
      'morpheus',
      'thermage',
      'rf tightening',
    ],
  },
  {
    canonical: 'cryolipolysis',
    cadence: 'course_based',
    isPOM: false,
    isOutcomeClaimHeavy: true,
    isFirstTrustBuilder: false,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: ['cryolipolysis', 'coolsculpting', 'fat freezing'],
  },
  {
    canonical: 'ems_body',
    cadence: 'course_based',
    isPOM: false,
    isOutcomeClaimHeavy: true,
    isFirstTrustBuilder: false,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: ['ems', 'emsculpt', 'tesla', 'muscle stimulation'],
  },
  // ── Beauty-therapist / impulse ───────────────────────────────────────
  {
    canonical: 'facial',
    cadence: 'impulse',
    isPOM: false,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: true,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: ['facial', 'dermaplaning', 'dermaplane'],
  },
  {
    canonical: 'brows',
    cadence: 'impulse',
    isPOM: false,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: true,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: ['brow', 'lamination', 'henna'],
  },
  {
    canonical: 'lashes',
    cadence: 'impulse',
    isPOM: false,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: true,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: ['lash lift', 'lash extension', 'lashes'],
  },
  {
    canonical: 'head_spa',
    cadence: 'impulse',
    isPOM: false,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: true,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: ['head spa', 'scalp treatment'],
  },
  {
    canonical: 'massage',
    cadence: 'impulse',
    isPOM: false,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: true,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: ['massage'],
  },
  {
    canonical: 'manicure',
    cadence: 'impulse',
    isPOM: false,
    isOutcomeClaimHeavy: false,
    isFirstTrustBuilder: true,
    isPremiumUpgrade: false,
    isSurgical: false,
    keywords: ['manicure', 'pedicure', 'gel nails', 'nails'],
  },
];

const DEFAULT_ENTRY: ServiceTaxonomyEntry = {
  canonical: 'unknown',
  cadence: 'unknown',
  isPOM: false,
  isOutcomeClaimHeavy: false,
  isFirstTrustBuilder: false,
  isPremiumUpgrade: false,
  isSurgical: false,
};

const normaliseName = (name: string): string =>
  ` ${name.toLowerCase().trim()} `;

export const taxonomiseService = (
  service: Pick<OrganizationService, 'name'>
): ServiceTaxonomyEntry => {
  const name = normaliseName(service.name);
  // "Non-surgical X" treatments (non-surgical facelift / nose job / bum lift,
  // etc.) often contain a surgical keyword as a substring but are NOT surgery.
  // Misclassifying one as surgical flips the whole clinic to consideration-sale
  // and collapses the ranking — so a "non-surgical" name can never match a
  // surgical entry.
  const isNonSurgical = /non[-\s]?surgical/.test(name);
  for (const entry of TAXONOMY) {
    if (entry.isSurgical && isNonSurgical) continue;
    for (const kw of entry.keywords) {
      if (name.includes(kw)) {
        const { keywords: _keywords, ...rest } = entry;
        return rest;
      }
    }
  }
  return DEFAULT_ENTRY;
};

// Heuristic price extractor — service rows have a freeform `priceText`
// (e.g. "€200 per session", "From €125", "£90"). We pull the lowest plausible
// number we can find so the engine has a numeric anchor for ranking and
// suggested-intro-price calculation. Returns undefined if no price is parseable.
//
// Cents — values are returned in cents/pence (i.e. * 100).
export const extractPriceCents = (
  service: Pick<OrganizationService, 'priceText'>
): number | undefined => {
  const text = service.priceText?.trim();
  if (!text) return undefined;

  // Match numbers with optional decimal, optional thousands separator.
  // Strip currency symbols/codes first to be permissive.
  const numbers = Array.from(
    text.matchAll(/(\d{1,3}(?:[,.]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)
  )
    .map((m) => m[0])
    .map((s) => {
      // Decide between "1,250" (thousands) and "1,25" (decimal). Treat the
      // comma as a thousands separator whenever the group after it has 3
      // digits; otherwise treat it as the decimal separator.
      if (s.includes(',') && !s.includes('.')) {
        const parts = s.split(',');
        const fractional = parts[parts.length - 1];
        if (fractional && fractional.length === 3) {
          return Number(parts.join(''));
        }
        return Number(s.replace(',', '.'));
      }
      return Number(s.replace(/,/g, ''));
    })
    // Filter out quantity-style numbers ("package of 3 for €500" — the 3 is
    // a count, not a price). Services don't cost less than €10 in practice;
    // anything below that is noise.
    .filter((n) => Number.isFinite(n) && n >= 10);

  if (numbers.length === 0) return undefined;

  // Use the smallest plausible price — pricing descriptions often quote
  // "€200 per session, package of 3 for €500" so the per-session figure is
  // the right anchor for intro pricing.
  const lowest = Math.min(...numbers);
  return Math.round(lowest * 100);
};
