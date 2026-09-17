import {
  organization,
  organizationLocation,
  organizationPackage,
  organizationService,
  practitioner,
} from '@borradh-workspace/database';
import {
  type CountryCode,
  type ServicePriceType,
  countryCodeValues,
} from '@borradh-workspace/labels';
import { and, eq } from 'drizzle-orm';
import { parsePriceText } from '../../../organization-services/index.js';
import { type DbConnection, notDeleted } from '../../../shared/index.js';
import { resolveScanSections } from '../analyze-website/ai-analysis.js';
import type { AnalysisSection } from '../analyze-website/analyze-website.schema.js';
import type {
  BlockedItem,
  ExistingRow,
  PlannedPackage,
  WebsiteAnalysisPlan,
  WebsiteAnalysisSnapshot,
} from './apply-website-analysis.schema.js';

/** Case/whitespace-insensitive key for matching a scanned name to a real row. */
export const nameKey = (value: string) => value.trim().toLowerCase();

/** Street addresses differ by punctuation far more often than by content. */
export const addressKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Stable identity for one actionable plan row: `<section>.<action>:<identity>`.
 *
 * The identity is the same normalised value the planner already matches on —
 * the lowercased name for a row being created, the existing row id for a row
 * already in the account. That makes the key reproducible the next time the
 * plan is built, which is what lets a deselection made in the review step
 * survive the rebuild the apply performs against live state.
 */
export const planRowKey = (
  section: 'service' | 'package' | 'team' | 'location',
  action: 'create' | 'price' | 'deactivate',
  identity: string
) => `${section}.${action}:${identity}`;

export const isCountryCode = (value: string): value is CountryCode =>
  (countryCodeValues as readonly string[]).includes(value.toLowerCase());

/**
 * Resolve an analyzed service to the structured price model.
 *
 * Priority: the analyzer's own structured `{ priceType, priceAmount }` (the
 * number the AI already found), falling back to parsing the freeform
 * `pricingDescription`/`priceText`. Both paths are best-effort and NEVER
 * fabricate a number — an unknown or ambiguous price resolves to `poa`.
 * `free`/`poa` carry a null `priceCents`.
 */
export const deriveServicePrice = (
  analyzedService: { priceType?: ServicePriceType; priceAmount?: number },
  priceText: string | undefined
): { priceType: ServicePriceType; priceCents: number | null } => {
  const { priceType, priceAmount } = analyzedService;

  if (priceType === 'free' || priceType === 'poa') {
    return { priceType, priceCents: null };
  }

  if (
    (priceType === 'fixed' || priceType === 'from') &&
    typeof priceAmount === 'number' &&
    Number.isFinite(priceAmount) &&
    priceAmount > 0
  ) {
    return { priceType, priceCents: Math.round(priceAmount * 100) };
  }

  // No usable structured price — fall back to parsing the freeform text.
  const parsed = parsePriceText(priceText ?? null);
  return { priceType: parsed.priceType, priceCents: parsed.priceCents };
};

/**
 * The currency symbols we recognise in scraped pricing copy, longest-first so
 * a prefixed symbol (`CA$`) wins over the bare one it contains (`$`).
 */
const CURRENCY_SYMBOLS = [
  'CA$',
  'A$',
  'NZ$',
  'R$',
  'kr',
  'zł',
  'CHF',
  '£',
  '€',
  '$',
  '¥',
  '₹',
] as const;

/**
 * The currency symbol a piece of scraped pricing copy is written in.
 *
 * The scan reads a website, not the account — a UK clinic writes `£600` no
 * matter what currency the account is configured in. Returning the symbol the
 * SITE used lets the confirmation step show the owner the price they actually
 * published. Returns undefined when the copy carries no symbol, in which case
 * the caller should fall back to the account's own currency.
 */
export const detectCurrencySymbol = (
  priceText: string | null | undefined
): string | undefined => {
  if (!priceText) return undefined;
  for (const symbol of CURRENCY_SYMBOLS) {
    if (priceText.includes(symbol)) return symbol;
  }
  return undefined;
};

/**
 * The one currency the scanned site prices in.
 *
 * A site sells in a single currency, so rather than tagging every row we take
 * a vote across all the pricing copy the scan read and hand the client one
 * symbol. Ties break toward the first symbol encountered, which is stable
 * because the service order is stable.
 */
export const detectScannedCurrencySymbol = (
  priceTexts: readonly (string | null | undefined)[]
): string | undefined => {
  const tally = new Map<string, number>();
  for (const text of priceTexts) {
    const symbol = detectCurrencySymbol(text);
    if (!symbol) continue;
    tally.set(symbol, (tally.get(symbol) ?? 0) + 1);
  }
  let winner: string | undefined;
  let best = 0;
  for (const [symbol, count] of tally) {
    if (count > best) {
      winner = symbol;
      best = count;
    }
  }
  return winner;
};

/** A price the scan actually read, as opposed to "we couldn't tell". */
const isConcretePrice = (price: {
  priceType: ServicePriceType;
  priceCents: number | null;
}) => price.priceCents !== null || price.priceType === 'free';

/**
 * Diff a website-analysis snapshot against the organization AS IT STANDS.
 *
 * This is the ONE place the matching rules live — name normalisation, what
 * counts as a price change, which rows are "not found". The preview endpoint
 * renders this, and the apply re-runs it and executes it, so the diff the owner
 * approved cannot describe different work from the diff that runs.
 *
 * Read-only. Every write is in `applyWebsiteAnalysis`.
 */
export async function buildWebsiteAnalysisPlan(
  db: DbConnection,
  organizationId: string,
  analysis: WebsiteAnalysisSnapshot,
  scanFor?: readonly AnalysisSection[]
): Promise<WebsiteAnalysisPlan> {
  const scanned = resolveScanSections(scanFor);
  const wasScanned = (section: AnalysisSection) => scanned.includes(section);

  // ── Services ────────────────────────────────────────────────────────────
  // The whole catalog, not a page of it: dedupe has to see every existing name
  // or a rescan duplicates the tail beyond the page size.
  const existingServices = await db
    .select({
      id: organizationService.id,
      name: organizationService.name,
      priceType: organizationService.priceType,
      priceCents: organizationService.priceCents,
      isActive: organizationService.isActive,
    })
    .from(organizationService)
    .where(eq(organizationService.organizationId, organizationId));

  const existingServiceByName = new Map(
    existingServices.map((row) => [nameKey(row.name), row])
  );

  const plan: WebsiteAnalysisPlan = {
    scanned,
    services: { create: [], priceChanges: [], notFound: [], unchanged: 0 },
    packages: { create: [], notFound: [], blocked: [] },
    team: { create: [], notFound: [] },
    locations: { create: [], blocked: [], matched: 0 },
    description: { locationId: null, current: null, scanned: null },
    hours: { current: null, scanned: null },
    brand: { current: {}, scanned: {} },
  };

  const matchedServiceIds = new Set<string>();

  // The symbol the SITE prices in. Computed across every service the scan read
  // (not just the ones that end up in the diff) so a site whose only new
  // services are POA still reports its currency.
  plan.scannedCurrencySymbol = detectScannedCurrencySymbol(
    analysis.services.map((service) => service.pricingDescription)
  );

  if (wasScanned('services')) {
    const seen = new Set<string>();
    for (const analyzed of analysis.services) {
      const name = analyzed.name.trim().slice(0, 100);
      if (!name) continue;
      const key = nameKey(name);
      if (seen.has(key)) continue;
      seen.add(key);

      const priceText = analyzed.pricingDescription?.trim() || undefined;
      const price = deriveServicePrice(analyzed, priceText);
      const existing = existingServiceByName.get(key);

      if (!existing) {
        plan.services.create.push({
          key: planRowKey('service', 'create', key),
          name,
          priceText,
          ...price,
        });
        continue;
      }

      matchedServiceIds.add(existing.id);

      // A `poa` result means "we couldn't read a price", not "this service is
      // now POA" — proposing it as a change would overwrite a real number with
      // an absence of information.
      if (!isConcretePrice(price)) {
        plan.services.unchanged += 1;
        continue;
      }
      if (
        existing.priceType === price.priceType &&
        existing.priceCents === price.priceCents
      ) {
        plan.services.unchanged += 1;
        continue;
      }
      plan.services.priceChanges.push({
        key: planRowKey('service', 'price', existing.id),
        id: existing.id,
        name: existing.name,
        fromPriceType: existing.priceType,
        fromPriceCents: existing.priceCents,
        ...price,
      });
    }

    // Only ACTIVE services can be "not found" — an already-retired one is not
    // news, and offering to deactivate it again would inflate the diff.
    plan.services.notFound = existingServices
      .filter((row) => row.isActive && !matchedServiceIds.has(row.id))
      .map(({ id, name }) => ({
        key: planRowKey('service', 'deactivate', id),
        id,
        name,
      }));
  }

  // ── Locations ───────────────────────────────────────────────────────────
  const existingLocations = await db
    .select({
      id: organizationLocation.id,
      addressLine1: organizationLocation.addressLine1,
      about: organizationLocation.about,
      isPrimary: organizationLocation.isPrimary,
    })
    .from(organizationLocation)
    .where(eq(organizationLocation.organizationId, organizationId));

  const existingAddresses = new Set(
    existingLocations.map((l) => addressKey(l.addressLine1))
  );

  if (wasScanned('location')) {
    const seen = new Set<string>();
    for (const analyzed of analysis.locations) {
      const key = addressKey(analyzed.addressLine1);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      if (existingAddresses.has(key)) {
        plan.locations.matched += 1;
        continue;
      }
      const country = analyzed.country.toLowerCase();
      if (!isCountryCode(country)) {
        plan.locations.blocked.push({
          name: analyzed.addressLine1,
          reason: `Unrecognised country "${analyzed.country}"`,
        });
        continue;
      }
      plan.locations.create.push({
        key: planRowKey('location', 'create', key),
        name: analyzed.name,
        addressLine1: analyzed.addressLine1,
        city: analyzed.city,
        county: analyzed.county,
        postalCode: analyzed.postalCode,
        country,
      });
    }
  }

  // ── Venue description (ENG-645) ─────────────────────────────────────────
  // The booking page's "About" prose lives on the LOCATION, not the org — see
  // organization_location.about, which the venue editor writes.
  if (wasScanned('description')) {
    const target =
      existingLocations.find((l) => l.isPrimary) ?? existingLocations[0];
    plan.description = {
      locationId: target?.id ?? null,
      current: target?.about ?? null,
      scanned: analysis.businessDescription ?? null,
    };
  }

  // ── Organization-level fields ───────────────────────────────────────────
  const [org] = await db
    .select({
      businessHours: organization.businessHours,
      logo: organization.logo,
      primaryColor: organization.primaryColor,
      secondaryColor: organization.secondaryColor,
      brandVoice: organization.brandVoice,
      targetAudienceDescription: organization.targetAudienceDescription,
    })
    .from(organization)
    .where(eq(organization.id, organizationId));

  if (wasScanned('hours')) {
    const scannedHours =
      analysis.businessHours && Object.keys(analysis.businessHours).length > 0
        ? analysis.businessHours
        : null;
    const currentHours =
      org?.businessHours && Object.keys(org.businessHours).length > 0
        ? org.businessHours
        : null;
    plan.hours = { current: currentHours, scanned: scannedHours };
  }

  if (wasScanned('brand')) {
    plan.brand = {
      current: {
        logoUrl: org?.logo ?? null,
        primaryColor: org?.primaryColor ?? null,
        secondaryColor: org?.secondaryColor ?? null,
        brandVoice: org?.brandVoice ?? null,
        targetAudienceDescription: org?.targetAudienceDescription ?? null,
      },
      scanned: {
        logoUrl: analysis.logoUrl ?? null,
        primaryColor: analysis.primaryColor ?? null,
        secondaryColor: analysis.secondaryColor ?? null,
        brandVoice: analysis.brandVoice?.length ? analysis.brandVoice : null,
        targetAudienceDescription:
          analysis.targetAudienceDescription?.trim() || null,
      },
    };
  }

  // ── Team ────────────────────────────────────────────────────────────────
  if (wasScanned('team')) {
    const existingStaff = await db
      .select({
        id: practitioner.id,
        name: practitioner.name,
        isActive: practitioner.isActive,
      })
      .from(practitioner)
      .where(
        and(
          eq(practitioner.organizationId, organizationId),
          notDeleted(practitioner)
        )
      );
    const existingStaffByName = new Map(
      existingStaff.map((row) => [nameKey(row.name), row])
    );

    const matchedStaffIds = new Set<string>();
    const seen = new Set<string>();
    for (const analyzed of analysis.practitioners) {
      const name = analyzed.name.trim();
      if (!name) continue;
      const key = nameKey(name);
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = existingStaffByName.get(key);
      if (existing) {
        matchedStaffIds.add(existing.id);
        continue;
      }
      plan.team.create.push({
        key: planRowKey('team', 'create', key),
        name,
        title: analyzed.title,
        email: analyzed.email,
      });
    }

    plan.team.notFound = existingStaff
      .filter((row) => row.isActive && !matchedStaffIds.has(row.id))
      .map(({ id, name }) => ({
        key: planRowKey('team', 'deactivate', id),
        id,
        name,
      }));
  }

  // ── Packages ────────────────────────────────────────────────────────────
  if (wasScanned('packages')) {
    const existingPackages = await db
      .select({
        id: organizationPackage.id,
        name: organizationPackage.name,
        isActive: organizationPackage.isActive,
      })
      .from(organizationPackage)
      .where(eq(organizationPackage.organizationId, organizationId));
    const existingPackageByName = new Map(
      existingPackages.map((row) => [nameKey(row.name), row])
    );

    // Item names resolve against the catalog as it WILL be — a package may name
    // a service this same apply is about to create.
    const resolvableServiceNames = new Set([
      ...existingServices.map((row) => nameKey(row.name)),
      ...plan.services.create.map((row) => nameKey(row.name)),
    ]);

    const matchedPackageIds = new Set<string>();
    const seen = new Set<string>();
    for (const analyzed of analysis.packages) {
      const name = analyzed.name.trim().slice(0, 100);
      if (!name) continue;
      const key = nameKey(name);
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = existingPackageByName.get(key);
      if (existing) {
        matchedPackageIds.add(existing.id);
        continue;
      }

      const itemNames = analyzed.serviceNames.filter((n) => n.trim());
      if (itemNames.length === 0) {
        plan.packages.blocked.push({
          name,
          reason: 'The site does not say which services it includes',
        });
        continue;
      }
      // A package whose contents we cannot name is worse than no package — it
      // would sell an empty bundle.
      const unresolved = itemNames.find(
        (n) => !resolvableServiceNames.has(nameKey(n))
      );
      if (unresolved) {
        plan.packages.blocked.push({
          name,
          reason: `Includes "${unresolved}", which isn't one of your services`,
        });
        continue;
      }

      plan.packages.create.push({
        key: planRowKey('package', 'create', key),
        name,
        description: analyzed.description,
        priceCents: Math.round(analyzed.priceAmount * 100),
        validityDays: analyzed.validityDays,
        serviceNames: itemNames,
      });
    }

    plan.packages.notFound = existingPackages
      .filter((row) => row.isActive && !matchedPackageIds.has(row.id))
      .map(({ id, name }) => ({
        key: planRowKey('package', 'deactivate', id),
        id,
        name,
      }));
  }

  return plan;
}

export type { BlockedItem, ExistingRow, PlannedPackage };
