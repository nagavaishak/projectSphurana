/**
 * catalog response PROJECTIONS — hand-composed from generated atoms.
 *
 * Covers the catalog response surface: services, service-categories, offers /
 * promotions, membership plans + sold memberships, service packages, and the
 * inventory-adjacent product brand / category / supplier lookups. Composed with
 * `z.object` / `.extend` / `z.array` from the generated atoms; pure Zod.
 *
 * Follows the proof pattern in ./leads.ts. Each response exports a schema plus
 * its `z.infer` type. Names are chosen not to collide with sibling response
 * files or the re-exported `*AtomSchema` names.
 */
import { z } from 'zod';
import {
  leadMembershipAtomSchema,
  membershipPlanAtomSchema,
  offerAtomSchema,
  organizationPackageAtomSchema,
  organizationPackageItemAtomSchema,
  organizationServiceAtomSchema,
  organizationServiceCategoryAtomSchema,
  organizationServiceVariantAtomSchema,
  productBrandAtomSchema,
  productCategoryAtomSchema,
  supplierAtomSchema,
} from '../generated/index.js';

// ============================================================================
// Shared pricing building blocks
// ============================================================================

/**
 * The org's single display currency ({ code, symbol }) — a computed shape (no
 * backing table), resolved from the org's country via `currencyForCountry`.
 * Threaded into the venue config and booking config so the frontend can render
 * prices via `formatServicePrice` without guessing the symbol.
 */
export const currencySchema = z.object({
  code: z.string(),
  symbol: z.string(),
});
export type CurrencyResponse = z.infer<typeof currencySchema>;

/**
 * A service variant (customer-chosen pricing option) on the wire — the
 * `organization_service_variant` atom, verbatim. Backs the variant CRUD
 * endpoints and the `variants` array of the listed-service projection.
 */
export const serviceVariantSchema = organizationServiceVariantAtomSchema;
export type ServiceVariantResponse = z.infer<typeof serviceVariantSchema>;

/** `GET /organization-services/:id/variants` — `{ items }` (a bare list). */
export const listServiceVariantsResponseSchema = z.object({
  items: z.array(serviceVariantSchema),
});
export type ListServiceVariantsResponseShape = z.infer<
  typeof listServiceVariantsResponseSchema
>;

// ============================================================================
// SERVICES
// ============================================================================

/**
 * An organization service on the wire.
 *
 * The atom types `painPoints` / `expectedResults` as `z.unknown()` (the
 * generator can't see through `jsonb().$type<...>()`), so they are hand-modeled
 * here as `string[] | null` to match the DB column shape. `priceText` stays a
 * free-text string (not integer cents) — services store their price as
 * display text, not a money amount.
 */
export const organizationServiceSchema = organizationServiceAtomSchema.extend({
  painPoints: z.array(z.string()).nullable(),
  expectedResults: z.array(z.string()).nullable(),
});
export type OrganizationService = z.infer<typeof organizationServiceSchema>;

/**
 * A listed service plus the two media-gating booleans the list endpoint
 * computes: `hasGraphicMedia` (uploaded photos/screenshots usable for a
 * graphic) and `hasVideoFootage` (its own uploaded video clips). Neither is a
 * column — both are joined/computed at list time.
 */
export const listedServiceSchema = organizationServiceSchema.extend({
  hasGraphicMedia: z.boolean(),
  hasVideoFootage: z.boolean(),
  // All variants (active + inactive), by sortOrder — so the dashboard service
  // form can load and edit them. Empty for single-price services.
  variants: z.array(serviceVariantSchema),
  // The branches offering the service. EMPTY MEANS EVERYWHERE (the empty-
  // junction convention), not "offered nowhere" — the promotion editor groups
  // its service picker by branch and needs the links.
  locationIds: z.array(z.string()),
});
export type ListedService = z.infer<typeof listedServiceSchema>;

/**
 * `POST /organization-services/:id/locations` — the branches offering the
 * service AFTER the add.
 *
 * The full resulting set rather than the delta, so a caller never has to
 * reconstruct it. An EMPTY array here keeps its usual meaning — offered at
 * every branch — which is what a no-op add against an unassigned service
 * returns.
 */
export const addServiceLocationsResponseSchema = z.object({
  serviceId: z.string(),
  locationIds: z.array(z.string()),
});
export type AddServiceLocationsResponse = z.infer<
  typeof addServiceLocationsResponseSchema
>;

/** `GET /organization-services` — the `{ items, total, limit, offset }` wrapper. */
export const listServicesResponseSchema = z.object({
  items: z.array(listedServiceSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ListServicesResponse = z.infer<typeof listServicesResponseSchema>;

// ============================================================================
// SERVICE CATEGORIES
// ============================================================================

/** A per-org service category row (the atom, verbatim). */
export const organizationServiceCategorySchema =
  organizationServiceCategoryAtomSchema;
export type OrganizationServiceCategory = z.infer<
  typeof organizationServiceCategorySchema
>;

/** `GET /service-categories` — a bare array of category rows (no wrapper). */
export const listServiceCategoriesResponseSchema = z.array(
  organizationServiceCategorySchema
);
export type ListServiceCategoriesResponse = z.infer<
  typeof listServiceCategoriesResponseSchema
>;

// ============================================================================
// OFFERS / PROMOTIONS
// ============================================================================

/**
 * An offer on the wire. Money is integer cents (`discountAmountCents`,
 * `originalPriceCents`, `offerPriceCents`) and `discountPercent` is a whole
 * number; which of those is populated depends on `discountType` (percentage
 * vs fixed-amount vs buy-X-get-Y) — the atom models every field nullable rather
 * than as a discriminated union, mirroring the flat DB row.
 */
export const offerSchema = offerAtomSchema;
export type Offer = z.infer<typeof offerSchema>;

/**
 * An offer joined with the ids of the services + locations it is scoped to.
 * `locationIds === []` means the offer applies to every org location
 * (empty-junction convention). This is the flat list-item shape.
 */
export const offerWithLinksSchema = offerSchema.extend({
  serviceIds: z.array(z.string()),
  locationIds: z.array(z.string()),
});
export type OfferWithLinks = z.infer<typeof offerWithLinksSchema>;

/** `GET /offers` — the `{ items, total, limit, offset }` wrapper. */
export const listOffersResponseSchema = z.object({
  items: z.array(offerWithLinksSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ListOffersResponse = z.infer<typeof listOffersResponseSchema>;

/**
 * `GET /offers/:id` — the detail projection, which nests the offer under an
 * `offer` key alongside its linked service + location ids.
 */
export const offerWithServicesSchema = z.object({
  offer: offerSchema,
  serviceIds: z.array(z.string()),
  locationIds: z.array(z.string()),
});
export type OfferWithServices = z.infer<typeof offerWithServicesSchema>;

// ============================================================================
// MEMBERSHIPS
// ============================================================================

/** A membership plan on the wire (`priceCents` is integer cents). */
export const membershipPlanSchema = membershipPlanAtomSchema;
export type MembershipPlan = z.infer<typeof membershipPlanSchema>;

/** A membership plan plus the ids of the services it covers. */
export const membershipPlanWithServicesSchema = membershipPlanSchema.extend({
  serviceIds: z.array(z.string()),
});
export type MembershipPlanWithServices = z.infer<
  typeof membershipPlanWithServicesSchema
>;

/**
 * A listed plan: the plan, the services it covers, and the branches selling it.
 *
 * `locationIds` is on the LIST only, mirroring `listedServiceSchema` — the
 * import dialog needs to tell "already sold here" from "available to copy", and
 * the join table is exposed nowhere else. EMPTY MEANS EVERY BRANCH.
 */
export const listedMembershipPlanSchema =
  membershipPlanWithServicesSchema.extend({
    locationIds: z.array(z.string()),
  });
export type ListedMembershipPlan = z.infer<typeof listedMembershipPlanSchema>;

/** `GET /membership-plans` — a bare array of plans (no wrapper). */
export const listMembershipPlansResponseSchema = z.array(
  listedMembershipPlanSchema
);
export type ListMembershipPlansResponse = z.infer<
  typeof listMembershipPlansResponseSchema
>;

/** A sold membership (a plan bought by a lead). */
export const leadMembershipSchema = leadMembershipAtomSchema;
export type LeadMembership = z.infer<typeof leadMembershipSchema>;

/** A sold membership joined with the plan it was bought from. */
export const leadMembershipWithPlanSchema = leadMembershipSchema.extend({
  plan: membershipPlanSchema,
});
export type LeadMembershipWithPlan = z.infer<
  typeof leadMembershipWithPlanSchema
>;

/** `GET /lead-memberships` — a bare array of sold memberships (no wrapper). */
export const listLeadMembershipsResponseSchema = z.array(
  leadMembershipWithPlanSchema
);
export type ListLeadMembershipsResponse = z.infer<
  typeof listLeadMembershipsResponseSchema
>;

// ============================================================================
// PACKAGES
// ============================================================================

/** A service package on the wire (`priceCents` is integer cents). */
export const organizationPackageSchema = organizationPackageAtomSchema;
export type OrganizationPackage = z.infer<typeof organizationPackageSchema>;

/** A raw package line item (the atom, verbatim). */
export const organizationPackageItemSchema = organizationPackageItemAtomSchema;
export type OrganizationPackageItem = z.infer<
  typeof organizationPackageItemSchema
>;

/** A package line item joined with the full service it references. */
export const packageItemWithServiceSchema =
  organizationPackageItemSchema.extend({
    service: organizationServiceSchema,
  });
export type PackageItemWithService = z.infer<
  typeof packageItemWithServiceSchema
>;

/** `GET /packages/:id` — a package with its expanded, service-joined items. */
export const packageWithItemsSchema = organizationPackageSchema.extend({
  items: z.array(packageItemWithServiceSchema),
});
export type PackageWithItems = z.infer<typeof packageWithItemsSchema>;

// ============================================================================
// INVENTORY LOOKUPS (product brand / category / supplier)
// ============================================================================

/** A product brand row (the atom, verbatim). */
export const productBrandSchema = productBrandAtomSchema;
export type ProductBrand = z.infer<typeof productBrandSchema>;

/** `GET /product-brands` — a bare array of brands (no wrapper). */
export const listProductBrandsResponseSchema = z.array(productBrandSchema);
export type ListProductBrandsResponse = z.infer<
  typeof listProductBrandsResponseSchema
>;

/** A product category row (the atom, verbatim — name only, no description). */
export const productCategorySchema = productCategoryAtomSchema;
export type ProductCategory = z.infer<typeof productCategorySchema>;

/** `GET /product-categories` — a bare array of categories (no wrapper). */
export const listProductCategoriesResponseSchema = z.array(
  productCategorySchema
);
export type ListProductCategoriesResponse = z.infer<
  typeof listProductCategoriesResponseSchema
>;

/** A supplier row (the atom, verbatim). */
export const supplierSchema = supplierAtomSchema;
export type Supplier = z.infer<typeof supplierSchema>;

/** `GET /suppliers` — a bare array of suppliers (no wrapper). */
export const listSuppliersResponseSchema = z.array(supplierSchema);
export type ListSuppliersResponse = z.infer<typeof listSuppliersResponseSchema>;

// ============================================================================
// Catalogue import — a computed result summary (no backing table).
// ============================================================================

/** A single rejected row from a catalogue import. */
export const serviceImportErrorSchema = z.object({
  row: z.number(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type ServiceImportErrorResponse = z.infer<
  typeof serviceImportErrorSchema
>;

/**
 * `POST /organization-services/import-csv` — the spreadsheet import summary.
 *
 * Named `…Response` throughout to avoid colliding with the feature package's
 * `ImportServicesCsvSummary`, which is the same shape on the server side.
 */
export const importServicesCsvResponseSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  updated: z.number(),
  errors: z.array(serviceImportErrorSchema),
  /** Data rows in the file, excluding the header. */
  rowsInFile: z.number(),
  /** Rows that survived parsing and had a usable name. */
  cleanedRows: z.number(),
  /** Rows dropped for having no service name. */
  skippedRows: z.number(),
  /** Categories created because the file named them and the org had none. */
  categoriesCreated: z.number(),
  /** Header → service-field mapping the import used. */
  columnMapping: z.record(z.string(), z.string()),
});
export type ImportServicesCsvResponse = z.infer<
  typeof importServicesCsvResponseSchema
>;
