import type { CountryCode } from '@borradh-workspace/labels';
import { servicePriceTypeValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import {
  type AnalysisSection,
  analysisSectionSchema,
} from '../analyze-website/analyze-website.schema.js';

/**
 * What to do with a section that is a LIST of rows (services, team, packages).
 *
 * - `add`     — create what the scan found and isn't in the account yet, and
 *               refresh prices on the ones that are. Touches nothing else.
 * - `replace` — everything `add` does, PLUS deactivate the rows the scan did
 *               NOT find, so the account ends up matching the website.
 * - `ignore`  — write nothing.
 *
 * `replace` DEACTIVATES (`isActive: false`); it never deletes. Deleting a
 * service is a hard row delete that cascades into appointment and package
 * history — and is refused outright when the service is linked to an asset or
 * a live offer, so a bulk delete would fail halfway and leave the account
 * inconsistent. Deactivating removes it from the catalog, the booking page and
 * every picker, is reversible from the list, and keeps history resolving.
 */
export const listSectionModeSchema = z.enum(['add', 'replace', 'ignore']);

export type ListSectionMode = z.infer<typeof listSectionModeSchema>;

/**
 * What to do with a section that is a SINGLE value (description, hours, brand).
 * There is nothing to "add" to a single field — either the scanned value
 * replaces what is there or it doesn't.
 */
export const valueSectionModeSchema = z.enum(['apply', 'ignore']);

export type ValueSectionMode = z.infer<typeof valueSectionModeSchema>;

/**
 * Per-section decisions for one apply. Everything defaults to the additive,
 * non-destructive choice — an apply with no modes at all creates what is
 * missing and removes nothing.
 *
 * `locations` has no `replace`: `organization_location` carries no `isActive`,
 * so the only way to remove one is a real delete, and a stale address is not
 * worth destroying booking history over. Locations are add-or-ignore.
 */
export const applyModesSchema = z.object({
  services: listSectionModeSchema.default('add'),
  packages: listSectionModeSchema.default('add'),
  team: listSectionModeSchema.default('add'),
  locations: z.enum(['add', 'ignore']).default('add'),
  description: valueSectionModeSchema.default('apply'),
  hours: valueSectionModeSchema.default('apply'),
  brand: valueSectionModeSchema.default('apply'),
});

export type ApplyModes = z.infer<typeof applyModesSchema>;

/**
 * Lenient view of an analysis result (shape produced by
 * `analyzeWebsiteResponseSchema`, possibly enriched with a business name by the
 * pipeline, possibly written by an older deploy). Every field degrades
 * independently via `.catch()` so one malformed value never discards the rest
 * of the snapshot.
 */
export const websiteAnalysisSnapshotSchema = z.object({
  businessName: z.string().min(1).optional().catch(undefined),
  siteTitle: z.string().min(1).optional().catch(undefined),
  services: z
    .array(
      z.object({
        name: z.string().min(1),
        pricingDescription: z.string().optional(),
        priceType: z.enum(servicePriceTypeValues).optional(),
        priceAmount: z.number().nonnegative().optional(),
      })
    )
    .optional()
    .default([])
    .catch([]),
  brandVoice: z.array(z.string()).optional().catch(undefined),
  targetAudienceDescription: z.string().optional().catch(undefined),
  suggestedCredibilityLines: z.array(z.string()).optional().catch(undefined),
  /** The venue "About" prose (ENG-645). */
  businessDescription: z.string().min(1).optional().catch(undefined),
  primaryColor: z.string().optional().catch(undefined),
  secondaryColor: z.string().optional().catch(undefined),
  logoUrl: z.string().url().optional().nullable().catch(undefined),
  businessHours: z
    .record(
      z.string().regex(/^[0-6]$/),
      z.object({
        from: z.number().int().min(0).max(1440),
        to: z.number().int().min(0).max(1440),
      })
    )
    .optional()
    .catch(undefined),
  locations: z
    .array(
      z.object({
        name: z.string().optional(),
        addressLine1: z.string().min(1),
        city: z.string().min(1),
        county: z.string().optional(),
        postalCode: z.string().optional(),
        country: z.string().min(1),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      })
    )
    .optional()
    .default([])
    .catch([]),
  practitioners: z
    .array(
      z.object({
        name: z.string().min(1),
        title: z.string().optional(),
        email: z.string().email().optional(),
      })
    )
    .optional()
    .default([])
    .catch([]),
  packages: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        priceAmount: z.number().positive(),
        serviceNames: z.array(z.string()).optional().default([]),
        validityDays: z.number().int().positive().optional(),
      })
    )
    .optional()
    .default([])
    .catch([]),
});

export type WebsiteAnalysisSnapshot = z.infer<
  typeof websiteAnalysisSnapshotSchema
>;

// ---------------------------------------------------------------------------
// The plan — what a scan WOULD do, computed against live account state
// ---------------------------------------------------------------------------

/** A price as the catalog models it, so the client can format it per currency. */
export interface PlannedPrice {
  priceType: (typeof servicePriceTypeValues)[number];
  priceCents: number | null;
}

/**
 * Stable identity for one actionable row of the plan.
 *
 * The plan is thrown away and REBUILT from live account state when the apply
 * runs, so a row cannot be referred to by its position or by the plan object
 * the preview returned. The key is derived from the same normalised name or
 * existing row id the planner already matches on, so a row the owner un-ticked
 * in the review step resolves to the same row a moment later.
 */
export interface PlanRow {
  key: string;
}

export interface PlannedService extends PlannedPrice, PlanRow {
  name: string;
  priceText?: string;
}

export interface PlannedPriceChange extends PlannedPrice, PlanRow {
  id: string;
  name: string;
  fromPriceType: (typeof servicePriceTypeValues)[number];
  fromPriceCents: number | null;
}

export interface ExistingRow extends PlanRow {
  id: string;
  name: string;
}

export interface PlannedPackage extends PlanRow {
  name: string;
  description?: string;
  priceCents: number;
  validityDays?: number;
  /** Service names, for display — resolution happens again at apply time. */
  serviceNames: string[];
}

export interface PlannedLocation extends PlanRow {
  name?: string;
  addressLine1: string;
  city: string;
  county?: string;
  postalCode?: string;
  /** Already validated against the country enum by the planner. */
  country: CountryCode;
}

export interface BlockedItem {
  name: string;
  reason: string;
}

/**
 * The diff between a scan and the account as it stands RIGHT NOW.
 *
 * Recomputed at apply time rather than carried over from the preview: the
 * account can change between the two (another window, a teammate), and an
 * apply that executed a stale plan would report work it didn't do.
 */
export interface WebsiteAnalysisPlan {
  /** Sections the scan actually asked for — everything else is "not looked at". */
  scanned: AnalysisSection[];
  services: {
    create: PlannedService[];
    priceChanges: PlannedPriceChange[];
    /** Active services the scan did not find. Only `replace` touches these. */
    notFound: ExistingRow[];
    /** Found and already correct — shown as a count, not a list. */
    unchanged: number;
  };
  packages: {
    create: PlannedPackage[];
    notFound: ExistingRow[];
    /** Found on the site but not creatable — with the reason why. */
    blocked: BlockedItem[];
  };
  team: {
    create: (PlanRow & { name: string; title?: string; email?: string })[];
    notFound: ExistingRow[];
  };
  locations: {
    create: PlannedLocation[];
    blocked: BlockedItem[];
    /** Addresses already on the account that the scan matched. */
    matched: number;
  };
  description: {
    locationId: string | null;
    current: string | null;
    scanned: string | null;
  };
  hours: {
    current: Record<string, { from: number; to: number }> | null;
    scanned: Record<string, { from: number; to: number }> | null;
  };
  brand: {
    current: BrandFields;
    scanned: BrandFields;
  };
  /**
   * The currency symbol the SCANNED SITE prices in, when it could be read.
   *
   * The prices in this plan came off a website, not out of the account, so
   * formatting them with the account's currency would show a UK owner `€600`
   * for something their own site publishes as `£600` — and this is the screen
   * that promises they see exactly what will change. Undefined when the site
   * carried no symbol, in which case the client falls back to the account
   * currency.
   */
  scannedCurrencySymbol?: string;
}

export interface BrandFields {
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  brandVoice?: string[] | null;
  targetAudienceDescription?: string | null;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * `analysis` is deliberately `unknown` here and parsed separately against
 * `websiteAnalysisSnapshotSchema` inside the service. Callers hand over raw
 * material — a `jsonb` column, a Redis-revived job result — and the lenient
 * snapshot schema is what turns that into something safe to write. Typing it as
 * the parsed shape would just push a cast onto every caller.
 */
const planInputShape = {
  organizationId: z.string().min(1, 'Organization ID is required'),
  analysis: z.unknown(),
  /**
   * Sections the scan covered. Absent = all of them. This is what separates
   * "the website lists no team" from "we never looked for a team" — both arrive
   * as an empty array, and only this says which, so only this can stop a
   * narrow scan from proposing to deactivate a whole section.
   */
  scanFor: z.array(analysisSectionSchema).optional(),
};

export const planWebsiteAnalysisSchema = z.object(planInputShape);

export type PlanWebsiteAnalysisInput = z.infer<
  typeof planWebsiteAnalysisSchema
>;

export const applyWebsiteAnalysisSchema = z.object({
  ...planInputShape,
  modes: applyModesSchema.partial().optional(),
  /**
   * Plan-row keys the owner un-ticked in the review step.
   *
   * DESELECTION rather than selection, so the contract degrades safely: a
   * caller that sends nothing applies the whole plan. That is exactly what the
   * onboarding bootstrap does, and what every caller did before a review step
   * existed — so the additive default survives a client that predates this
   * field, and a key that no longer matches any row is simply inert.
   */
  deselected: z.array(z.string().min(1)).max(5000).optional(),
});

export type ApplyWebsiteAnalysisInput = z.infer<
  typeof applyWebsiteAnalysisSchema
>;

/**
 * What the apply actually did — counts of rows WRITTEN, plus `skipped`, which
 * explains in customer-readable terms everything the scan found and did not
 * write. Without that last field the panel can only report "12 of 20 created"
 * and leave the owner guessing about the other 8.
 */
export interface ApplyWebsiteAnalysisOutput {
  createdServiceIds: string[];
  servicesPriceUpdated: number;
  servicesDeactivated: number;
  locationsCreated: number;
  venueDescriptionUpdated: boolean;
  openingHoursUpdated: boolean;
  brandUpdated: boolean;
  practitionersCreated: number;
  practitionersDeactivated: number;
  packagesCreated: number;
  packagesDeactivated: number;
  skipped: string[];
}
