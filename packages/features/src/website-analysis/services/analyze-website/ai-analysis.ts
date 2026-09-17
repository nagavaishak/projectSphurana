/**
 * AI analysis prompt building and response parsing.
 *
 * Pure functions for constructing the GPT prompt and parsing the structured
 * JSON response into the AnalyzeWebsiteResponse type.
 */

import {
  parseJsonResponse,
  safeGet,
  safeGetStringArray,
} from '@borradh-workspace/ai';
import { servicePriceTypeValues } from '@borradh-workspace/labels';
import type { Logger } from '@borradh-workspace/observability';
import {
  type AnalysisSection,
  type AnalyzeWebsiteResponse,
  analysisSectionValues,
} from './analyze-website.schema.js';

/**
 * Maximum source material included in one website-analysis completion.
 *
 * Crawlers may return an entire site, while the completion also asks for a
 * potentially large structured service list. Keeping the combined input below
 * roughly 25k tokens gives the model room for the 16k-token response and keeps
 * response latency within the analysis job's deadline.
 */
const ANALYSIS_CONTEXT_LIMITS = {
  website: 18_000,
  subpages: 10_000,
  location: 4_000,
  team: 4_000,
  facebook: 2_000,
  booking: 20_000,
  enriched: 16_000,
  serviceHints: 20_000,
  jsonLd: 4_000,
} as const;

function boundedContext(
  label: string,
  content: string | undefined,
  limit: number
): string {
  if (!content) return '';
  if (content.length <= limit) return `\n\n${label}:\n${content}`;

  return `\n\n${label} (first ${limit.toLocaleString()} characters; remaining content was omitted to keep this analysis reliable):\n${content.slice(0, limit)}`;
}

/**
 * The per-section instruction blocks, keyed by the section that requests them.
 *
 * Held apart from the prompt body so a narrowed scan omits the block entirely
 * rather than asking for a field it will then throw away: a prompt that never
 * mentions packages cannot hallucinate one, and the shorter prompt is cheaper.
 * The blocks are numbered at assembly time, so removing one never leaves a gap
 * in the list the model is reading.
 */
const PROMPT_BLOCKS: Record<AnalysisSection, string[]> = {
  services: [
    `"services": Array of objects representing the services this business offers. Each object has "name" (the service name), optionally "pricingDescription" (detailed freeform pricing text), and a STRUCTURED price ("priceType" + "priceAmount", see below). Look across ALL provided pages (homepage, additional pages, pricing pages, AND booking system page) for services and pricing information.

CRITICAL rules for services:
- Use the EXACT service names as they appear on the website or booking system. Do NOT rephrase, expand, or add qualifiers. If the website says "Anti-Wrinkle", use "Anti-Wrinkle" — not "Anti-Wrinkle Treatment" or "Anti-Wrinkle Injections".
- Do NOT invent or infer services that are not explicitly listed. Only include services that are clearly named on the website or booking system.
- Include ALL services listed across the website AND booking system, not just a subset. If the sources together list 20 services, return all 20.
- If the booking system page is provided, it is the MOST RELIABLE source for services and pricing. Prefer booking system service names and prices over website content when they conflict.
- Consolidate services from both website and booking system: if the same service appears in both, merge them (use the booking system's pricing if available). Do not duplicate services that appear in both sources.
- If the website lists service categories (e.g. "Packages", "Skin Boosters"), include those too — they are real service offerings.
- Do NOT include pages, features, or tools (e.g. "AI Makeover Preview", "Book Now") as services.
- Extract pricing from any page where it appears. Match prices to the correct service by name.

CRITICAL rules for pricingDescription:
- Include ALL pricing details found for each service — not just a single price.
- If there are different prices for different options (e.g. areas, sizes, session counts), list them all. Example: "1 Area: £160, 2 Areas: £190, 3 Areas: £240"
- If there are package/bundle prices (e.g. per session vs 6 sessions), include both. Example: "Per Session: £285, 6 Sessions: £1,425"
- If prices differ by gender or body area, include the breakdown. Example: "Women: Full Body £285/session (£1,425 for 6), Half Legs £75/session (£375 for 6). Men: Full Body £300/session (£1,500 for 6)"
- If the pricing says "From" or "Starting at", preserve that. Example: "From £250"
- Include any discount conditions, bonus offers, or special terms mentioned alongside the pricing. Example: "Per Session: £285, 6 Sessions: £1,425 (discount only when paid upfront)"
- Include brief service descriptions when provided alongside pricing — what the service includes or involves. Example: "£95 — Combines microdermabrasion, creams, virtual mesotherapy and facial massaging"
- Keep pricing text concise but complete — every price point, discount, and service detail mentioned on the website should be captured.
- If no specific pricing is found for a service, OMIT the pricingDescription field entirely. Do NOT use generic placeholders like "Prices Vary", "Contact for pricing", "Price on request", or similar.

CRITICAL rules for the STRUCTURED price ("priceType" + "priceAmount"):
- "priceType" must be one of: "fixed" (one set price, e.g. "€50"), "from" (a floor / "From €50", "€150+", "Starting at"), "free" (no charge), or "poa" (price on consultation — unknown, variable, or quoted in person).
- "priceAmount" is the single numeric price anchor in whole local-currency units — just the number, no symbol (e.g. 150 for "£150", 12.5 for "€12.50"). For "fixed" it is the price; for "from" it is the floor (the LOWEST price if several are listed).
- Emit "priceAmount" ONLY for "fixed" or "from". For "free" and "poa", OMIT "priceAmount" entirely.
- If a service lists several distinct prices (e.g. "1 Area £160, 2 Areas £190"), set priceType "from" and priceAmount to the lowest (160), and keep the full breakdown in pricingDescription.
- If you cannot find any price for a service, set priceType "poa" and omit priceAmount. NEVER guess a number — "poa" is the correct, safe answer for an unknown price.`,
  ],
  description: [
    `"businessDescription": The customer-facing "about this venue" description for the business's booking page — 2-4 sentences, written in the third person, describing what the business does, the treatments or experience a customer can expect, and anything that makes visiting it distinctive (setting, specialisms, qualifications). This is the copy a customer reads while deciding whether to book, NOT ad targeting copy.
- Base it ONLY on what the website/booking system actually says. Do NOT invent claims, awards, years in business, or client numbers.
- Prefer the business's own "About us" / "Welcome" prose where one exists — lightly tidied, not copied verbatim at length.
- Do not include prices, opening hours, phone numbers or addresses (those are captured separately).
- If the sources say too little to write an honest description, OMIT this field entirely.`,
  ],
  brand: [
    `"targetAudienceDescription": A 1-2 sentence description of the ideal customer for this business. Consider age range, gender, lifestyle, and what they're looking for. Example: "Women aged 30-55 seeking non-surgical facial rejuvenation treatments to maintain a youthful appearance."`,
    `"brandVoice": Array of 3-5 adjectives that describe the brand's communication style based on their website copy. Examples: "luxurious", "professional", "warm", "clinical", "approachable", "high-end", "friendly", "results-driven".`,
    `"suggestedCredibilityLines": Array of 4-6 credibility statements this business could use in ads. These should be based on what's mentioned or implied in their content. Examples:
   - "Trusted by over 500 clients across [location]"
   - "Doctor-led aesthetic clinic"
   - "Award-winning beauty specialists"
   - "Over 15 years of experience"
   - "CQC registered clinic"
   - "Medically-trained practitioners"`,
    `"primaryColor": The main brand color as a hex code (e.g., "#7c3aed"). If brand colors were detected above, you MUST pick the primary from that list (the most prominent, vibrant one suitable for buttons/CTAs) — do NOT substitute a generic color. Only invent a color when no colors were detected.`,
    `"secondaryColor": A complementary secondary/background color as a hex code (e.g., "#f5f5f5"). Prefer another detected brand color (a lighter or more neutral one); only invent one if the detected list has no suitable second color.`,
  ],
  location: [
    `"locations": Array of physical business locations found on the website and any location/contact subpages provided. For each location provide: "name" (optional branch name), "addressLine1" (street address), "city", "county" (state/province/county, optional), "postalCode" (optional), "country" (2-letter ISO code, e.g. "ie" for Ireland, "gb" for UK, "us" for USA). Look carefully at the homepage, location page content, and structured data for addresses. Return an empty array only if no locations can be identified.`,
  ],
  hours: [
    `"businessHours": Opening hours extracted from the website. Return as an object where keys are day-of-week numbers ("0"=Sunday, "1"=Monday, ... "6"=Saturday) and values are objects with "from" and "to" in minutes from midnight (e.g. 9:00 AM = 540, 5:00 PM = 1020, 6:00 PM = 1080). Only include days the business is open. Look for opening hours in structured data (JSON-LD openingHoursSpecification), contact pages, footer content, or any mention of business hours. If no hours can be found, omit this field entirely.`,
  ],
  team: [
    `"practitioners": Array of team members/practitioners/staff found on the website OR listed as bookable staff on the booking system page. Look for "Meet the Team", "Our Team", "About Us", "Our Specialists", "Our Practitioners", staff profile sections, booking-system staff pickers, or similar. For each person provide: "name" (full name, required), "title" (their role/specialization, optional, e.g. "Senior Stylist", "Aesthetic Nurse", "Clinic Director") and "email" (ONLY if a personal email address for that specific person is published — never the generic info@ address, and never a guessed one). Return an empty array if no team members can be identified. Do NOT include generic roles without names.`,
  ],
  packages: [
    `"packages": Array of bundles/courses the business sells as a single purchase — e.g. "Course of 6 Laser Sessions", "Bridal Package", "3 for 2 Facials". For each provide: "name", "priceAmount" (the TOTAL package price as a number in whole local-currency units, no symbol), "serviceNames" (array of the service names this package includes — use the EXACT names as they appear in your "services" array above), optionally "description" and "validityDays" (if the offer states an expiry, e.g. "valid 12 months" → 365).
- Only include a package with a clearly stated total price. If only a per-session price is given, that belongs in the service's pricingDescription, not here.
- "serviceNames" must reference services you listed in "services". Do not invent an item name.
- Return an empty array if the business sells no bundles.`,
  ],
};

/**
 * Order the blocks appear in, independent of the order the caller asked for
 * them — services first because packages reference its names, brand last.
 */
const PROMPT_BLOCK_ORDER: readonly AnalysisSection[] = [
  'services',
  'packages',
  'description',
  'location',
  'hours',
  'team',
  'brand',
];

/**
 * Normalise a requested section list into the sections the prompt will carry.
 * `packages` pulls in `services`: a package names its items by service name, so
 * asking for bundles without asking for services yields items that can never
 * resolve.
 */
export function resolveScanSections(
  scanFor?: readonly AnalysisSection[]
): AnalysisSection[] {
  const requested = new Set<AnalysisSection>(
    scanFor && scanFor.length > 0 ? scanFor : analysisSectionValues
  );
  if (requested.has('packages')) requested.add('services');
  return PROMPT_BLOCK_ORDER.filter((section) => requested.has(section));
}

/**
 * Build the GPT prompt for website analysis.
 */
export function buildAnalysisPrompt(
  websiteText: string,
  facebookText?: string,
  extractedColors?: string[],
  jsonLdLocations?: string,
  locationPageText?: string,
  teamPageText?: string,
  subpageTexts?: string,
  bookingSystemText?: string,
  enrichedContent?: string,
  enrichedServiceHints?: string,
  scanFor?: readonly AnalysisSection[]
): string {
  const sections = resolveScanSections(scanFor);

  // Put the curated, service-specific sources first: if a source is capped,
  // the most actionable evidence remains available to the model.
  let context = boundedContext(
    'Pre-extracted services from multiple scraping sources (Firecrawl crawl, Browser Use AI agent, and OCR from price list images — these were independently extracted and deduplicated. Treat as a HIGHLY RELIABLE source. Include ALL of these services in the final output, merging with any found in the basic scrape above)',
    enrichedServiceHints,
    ANALYSIS_CONTEXT_LIMITS.serviceHints
  );
  context += boundedContext(
    "Booking system page content (this is the business's online booking page — it often contains the most accurate and complete list of services with prices, durations, and categories)",
    bookingSystemText,
    ANALYSIS_CONTEXT_LIMITS.booking
  );
  context += boundedContext(
    'Website content',
    websiteText,
    ANALYSIS_CONTEXT_LIMITS.website
  );
  context += boundedContext(
    'Enriched website content (full site crawl via Firecrawl and/or browser automation — may contain additional pages, services, and pricing not found in the basic website scrape above)',
    enrichedContent,
    ANALYSIS_CONTEXT_LIMITS.enriched
  );
  context += boundedContext(
    'Additional website pages',
    subpageTexts,
    ANALYSIS_CONTEXT_LIMITS.subpages
  );
  context += boundedContext(
    'Location/contact page content',
    locationPageText,
    ANALYSIS_CONTEXT_LIMITS.location
  );
  context += boundedContext(
    'Team/about page content',
    teamPageText,
    ANALYSIS_CONTEXT_LIMITS.team
  );
  context += boundedContext(
    'Facebook page content',
    facebookText,
    ANALYSIS_CONTEXT_LIMITS.facebook
  );

  // Both hints are only worth their tokens when the section that reads them
  // was actually requested.
  let colorContext = '';
  if (
    sections.includes('brand') &&
    extractedColors &&
    extractedColors.length > 0
  ) {
    colorContext = `\n\nBrand colors detected on the website (from a rendered homepage screenshot and the site's CSS, ordered most-prominent first): ${extractedColors.join(', ')}. These are the business's ACTUAL brand colors — use them for primaryColor/secondaryColor. Only invent a color if this list is empty.`;
  }

  let locationContext = '';
  if (sections.includes('location') && jsonLdLocations) {
    locationContext = boundedContext(
      'Structured location data found',
      jsonLdLocations,
      ANALYSIS_CONTEXT_LIMITS.jsonLd
    );
  }

  const numberedBlocks = sections
    .flatMap((section) => PROMPT_BLOCKS[section])
    .map((block, index) => `${index + 1}. ${block}`)
    .join('\n\n');

  return `You are analyzing a beauty/wellness/clinic business website to help with their marketing onboarding.

${context}${colorContext}${locationContext}

Based on this content, provide a JSON response with:

${numberedBlocks}

Return ONLY valid JSON, no markdown formatting or explanations.`;
}

/**
 * Parse and validate the AI response.
 *
 * `scanFor` must be the SAME list the prompt was built from. The brand fields
 * carry hard-coded defaults (a purple, a grey, a generic audience line) for the
 * case where the model omits them — which is right when we asked and got
 * nothing, but would be a fabrication when we never asked. So a section that
 * was not scanned yields empty values rather than defaults.
 */
export function parseAnalysisResponse(
  responseText: string,
  extractedLogo: string | null,
  logger?: Logger,
  scanFor?: readonly AnalysisSection[]
): AnalyzeWebsiteResponse {
  const parseResult = parseJsonResponse<Record<string, unknown>>(responseText);

  if (!parseResult.success || !parseResult.data) {
    throw new Error('Failed to parse AI response as JSON');
  }

  const sections = resolveScanSections(scanFor);
  const scanned = (section: AnalysisSection) => sections.includes(section);

  const result = parseResult.data;

  // Parse locations array safely
  const rawLocations = Array.isArray(result.locations) ? result.locations : [];
  if (logger) {
    logger.info(
      `[parseResponse] AI returned ${rawLocations.length} raw locations`
    );
    if (rawLocations.length > 0) {
      logger.debug(
        `[parseResponse] raw locations: ${JSON.stringify(rawLocations).slice(0, 2000)}`
      );
    }
  }
  const locations = rawLocations
    .filter(
      (loc: unknown): loc is Record<string, unknown> =>
        typeof loc === 'object' && loc !== null
    )
    .map((loc: Record<string, unknown>) => ({
      name: typeof loc.name === 'string' ? loc.name : undefined,
      addressLine1:
        typeof loc.addressLine1 === 'string' ? loc.addressLine1 : '',
      city: typeof loc.city === 'string' ? loc.city : '',
      county: typeof loc.county === 'string' ? loc.county : undefined,
      postalCode:
        typeof loc.postalCode === 'string' ? loc.postalCode : undefined,
      country: typeof loc.country === 'string' ? loc.country.toLowerCase() : '',
    }))
    .filter((loc) => loc.addressLine1 && loc.city);
  if (logger) {
    logger.info(
      `[parseResponse] ${locations.length} locations after filtering (need addressLine1 && city)`
    );
  }

  // Parse business hours safely
  let businessHours: Record<string, { from: number; to: number }> | undefined;
  if (
    result.businessHours &&
    typeof result.businessHours === 'object' &&
    !Array.isArray(result.businessHours)
  ) {
    const hours: Record<string, { from: number; to: number }> = {};
    for (const [key, value] of Object.entries(
      result.businessHours as Record<string, unknown>
    )) {
      if (/^[0-6]$/.test(key) && typeof value === 'object' && value !== null) {
        const entry = value as Record<string, unknown>;
        const from = typeof entry.from === 'number' ? entry.from : undefined;
        const to = typeof entry.to === 'number' ? entry.to : undefined;
        if (
          from !== undefined &&
          to !== undefined &&
          from >= 0 &&
          to <= 1440 &&
          from < to
        ) {
          hours[key] = { from, to };
        }
      }
    }
    if (Object.keys(hours).length > 0) {
      businessHours = hours;
    }
  }

  // Parse practitioners array safely
  const rawPractitioners = Array.isArray(result.practitioners)
    ? result.practitioners
    : [];
  const practitioners = rawPractitioners
    .filter(
      (p: unknown): p is Record<string, unknown> =>
        typeof p === 'object' && p !== null
    )
    .map((p: Record<string, unknown>) => ({
      name: typeof p.name === 'string' ? p.name : '',
      title: typeof p.title === 'string' ? p.title : undefined,
      // Only a syntactically valid address survives; anything else is dropped
      // so apply-website-analysis falls back to its `.invalid` placeholder.
      email:
        typeof p.email === 'string' &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)
          ? p.email.trim().toLowerCase()
          : undefined,
    }))
    .filter((p) => p.name.trim().length > 0);

  // Parse packages safely. A package needs a name, a positive total price and
  // at least one item name — anything else is dropped rather than half-created.
  const rawPackages = Array.isArray(result.packages) ? result.packages : [];
  const packages = rawPackages
    .filter(
      (p: unknown): p is Record<string, unknown> =>
        typeof p === 'object' && p !== null
    )
    .map((p: Record<string, unknown>) => ({
      name: typeof p.name === 'string' ? p.name.trim() : '',
      description:
        typeof p.description === 'string' && p.description.trim()
          ? p.description.trim()
          : undefined,
      priceAmount:
        typeof p.priceAmount === 'number' && Number.isFinite(p.priceAmount)
          ? p.priceAmount
          : -1,
      serviceNames: (Array.isArray(p.serviceNames) ? p.serviceNames : [])
        .filter((n: unknown): n is string => typeof n === 'string')
        .map((n) => n.trim())
        .filter((n) => n.length > 0),
      validityDays:
        typeof p.validityDays === 'number' &&
        Number.isInteger(p.validityDays) &&
        p.validityDays > 0
          ? p.validityDays
          : undefined,
    }))
    .filter(
      (p) => p.name.length > 0 && p.priceAmount > 0 && p.serviceNames.length > 0
    );

  // Parse services: support both object array (new) and string array (legacy/fallback)
  const rawServices = Array.isArray(result.services) ? result.services : [];
  const services = rawServices
    .map((s: unknown) => {
      if (typeof s === 'string') return { name: s };
      if (typeof s === 'object' && s !== null) {
        const obj = s as Record<string, unknown>;
        // Structured price. Only trust priceType if it's one of the four valid
        // values; only trust priceAmount for fixed/from (free/poa carry no
        // amount). A bad/absent priceType degrades to nothing (apply-analysis
        // then falls back to parsing pricingDescription).
        const rawType =
          typeof obj.priceType === 'string' ? obj.priceType : undefined;
        const priceType = (
          servicePriceTypeValues as readonly string[]
        ).includes(rawType ?? '')
          ? (rawType as (typeof servicePriceTypeValues)[number])
          : undefined;
        const priceAmount =
          typeof obj.priceAmount === 'number' &&
          Number.isFinite(obj.priceAmount) &&
          obj.priceAmount >= 0 &&
          (priceType === 'fixed' || priceType === 'from')
            ? obj.priceAmount
            : undefined;
        return {
          name: typeof obj.name === 'string' ? obj.name : '',
          ...(typeof obj.pricingDescription === 'string' &&
          obj.pricingDescription
            ? { pricingDescription: obj.pricingDescription }
            : {}),
          ...(priceType ? { priceType } : {}),
          ...(priceAmount !== undefined ? { priceAmount } : {}),
        };
      }
      return null;
    })
    .filter(
      (
        s
      ): s is {
        name: string;
        pricingDescription?: string;
        priceType?: (typeof servicePriceTypeValues)[number];
        priceAmount?: number;
      } => s !== null && s.name.trim().length > 0
    );

  const brandScanned = scanned('brand');

  return {
    services,
    targetAudienceDescription: brandScanned
      ? safeGet(
          result,
          'targetAudienceDescription',
          'Your ideal customers seeking quality services.'
        )
      : '',
    // No default: an absent description must stay absent so apply never
    // overwrites a real venue "About" with filler.
    businessDescription:
      scanned('description') &&
      typeof result.businessDescription === 'string' &&
      result.businessDescription.trim()
        ? result.businessDescription.trim()
        : undefined,
    brandVoice: brandScanned
      ? safeGetStringArray(result, 'brandVoice', 10)
      : [],
    suggestedCredibilityLines: brandScanned
      ? safeGetStringArray(result, 'suggestedCredibilityLines', 10)
      : [],
    primaryColor: brandScanned
      ? safeGet(result, 'primaryColor', '#7c3aed')
      : undefined,
    secondaryColor: brandScanned
      ? safeGet(result, 'secondaryColor', '#f5f5f5')
      : undefined,
    // The logo comes from the page's own markup, not the model — but it is
    // still brand material, so a non-brand scan must not carry it either.
    logoUrl: brandScanned ? extractedLogo : null,
    locations: scanned('location') ? locations : [],
    businessHours: scanned('hours') ? businessHours : undefined,
    practitioners: scanned('team') ? practitioners : [],
    packages: scanned('packages') ? packages : [],
  };
}
