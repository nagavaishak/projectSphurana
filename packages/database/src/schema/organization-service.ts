import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  vector,
} from 'drizzle-orm/pg-core';
import {
  childOrgRlsPolicy,
  joinRlsPolicy,
  orgRlsPolicy,
} from '../rls-policy.js';
import { asset } from './asset.js';
import { organizationLocation } from './organization-location.js';
import { organizationServiceCategory } from './organization-service-category.js';
import {
  type BusinessType,
  depositBasisEnum,
  organization,
  servicePaymentPolicyEnum,
} from './organization.js';
import { stockClip } from './stock-clip.js';
import { technique, treatmentAgent } from './treatment-taxonomy.js';

import {
  assetAnalysisStatusLabels,
  assetAnalysisStatusValues,
  assetContentTypeLabels,
  assetContentTypeValues,
} from '@borradh-workspace/labels';
// Import labels from enums (pure TypeScript)
import {
  serviceCategoryLabels,
  serviceCategoryValues,
  servicePriceTypeLabels,
  servicePriceTypeValues,
  serviceSpecSourceValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  serviceCategoryLabels,
  serviceCategoryValues,
  servicePriceTypeLabels,
  servicePriceTypeValues,
  assetAnalysisStatusLabels,
  assetAnalysisStatusValues,
  assetContentTypeLabels,
  assetContentTypeValues,
};
export type { ServicePriceType } from '@borradh-workspace/labels';
export {
  assetContentTypeTagLabels,
  assetContentTypeTagValues,
  contentTypeToTagMap,
} from '@borradh-workspace/labels';
export type { ServiceCategory } from '@borradh-workspace/labels';
export type {
  AssetAnalysisStatus,
  AssetContentType,
  AssetContentTypeTag,
} from '@borradh-workspace/labels';

// Import type for local use in interfaces
import type { AssetContentType } from '@borradh-workspace/labels';

// Database enums
export const serviceCategoryEnum = pgEnum(
  'service_category',
  serviceCategoryValues
);

export const servicePriceTypeEnum = pgEnum(
  'service_price_type',
  servicePriceTypeValues
);

// Provenance of a service's footage spec. A real pgEnum (not text + $type) so
// the contract generator resolves it against the shared labels array and emits
// z.enum(serviceSpecSourceValues) rather than a bare z.string().
export const serviceSpecSourceEnum = pgEnum(
  'service_spec_source',
  serviceSpecSourceValues
);

export const assetAnalysisStatusEnum = pgEnum(
  'asset_analysis_status',
  assetAnalysisStatusValues
);

export const assetContentTypeEnum = pgEnum(
  'asset_content_type',
  assetContentTypeValues
);

// Default services by business type
export const defaultServicesByBusinessType: Record<BusinessType, string[]> = {
  // Beauty & Hair
  hairdresser: [
    'Haircut',
    'Blow Dry',
    'Hair Coloring',
    'Balayage',
    'Highlights',
    'Extensions',
  ],
  barber: [
    'Haircut',
    'Beard Trim',
    'Hot Towel Shave',
    'Fade',
    'Hair & Beard Combo',
  ],
  salon: [
    'Haircut',
    'Hair Coloring',
    'Manicure',
    'Pedicure',
    'Facial',
    'Waxing',
  ],
  spa: ['Massage', 'Facial', 'Body Wrap', 'Aromatherapy', 'Hot Stone'],
  nail_salon: [
    'Manicure',
    'Pedicure',
    'Gel Nails',
    'Acrylic Nails',
    'Nail Art',
  ],
  tattoo_studio: [
    'Tattoo',
    'Cover Up',
    'Piercing',
    'Touch-Up',
    'Custom Design',
  ],
  // Clinics & Medical Aesthetics
  aesthetic_clinic: [
    'Botox',
    'Dermal Fillers',
    'Lip Fillers',
    'PRP Treatment',
    'Chemical Peel',
    'Microneedling',
  ],
  cosmetic_clinic: [
    'Botox',
    'Dermal Fillers',
    'Lip Enhancement',
    'Thread Lift',
    'Non-Surgical Facelift',
  ],
  skin_clinic: [
    'Chemical Peel',
    'Microdermabrasion',
    'Acne Treatment',
    'Pigmentation Treatment',
    'Skin Analysis',
  ],
  dermatology_clinic: [
    'Skin Consultation',
    'Mole Check',
    'Acne Treatment',
    'Eczema Treatment',
    'Psoriasis Treatment',
  ],
  laser_clinic: [
    'Laser Hair Removal',
    'IPL Treatment',
    'Tattoo Removal',
    'Skin Rejuvenation',
  ],
  fat_freezing_clinic: [
    'CoolSculpting',
    'Fat Freezing',
    'Body Contouring',
    'Cellulite Treatment',
  ],
  dental_practice: [
    'Dental Check-up',
    'Teeth Whitening',
    'Dental Implants',
    'Invisalign',
    'Veneers',
  ],
  medical_spa: [
    'IV Drip',
    'Vitamin Injections',
    'Medical Facial',
    'Botox',
    'Dermaplaning',
  ],
  wellness_clinic: [
    'Wellness Consultation',
    'Nutrition Advice',
    'Hormone Therapy',
    'Vitamin Infusion',
  ],
  physiotherapy: [
    'Initial Assessment',
    'Sports Massage',
    'Rehabilitation',
    'Dry Needling',
    'Manual Therapy',
  ],
  chiropractic: [
    'Spinal Adjustment',
    'Initial Consultation',
    'Maintenance Visit',
    'Posture Assessment',
  ],
  beauty_clinic: [
    'Facial',
    'Microdermabrasion',
    'LED Light Therapy',
    'Dermaplaning',
    'Hydrafacial',
  ],
  iv_therapy_clinic: [
    'Vitamin C Drip',
    'Hydration Drip',
    'Energy Boost',
    'Immune Support',
    'NAD+ Therapy',
  ],
  weight_loss_clinic: [
    'Weight Loss Consultation',
    'Meal Planning',
    'Fat Dissolving Injections',
    'Metabolic Testing',
  ],
  anti_aging_clinic: [
    'Anti-Aging Consultation',
    'PRP Facial',
    'Stem Cell Therapy',
    'Hormone Optimization',
  ],
  hair_restoration: [
    'Hair Transplant Consultation',
    'PRP Hair Treatment',
    'Scalp Micropigmentation',
    'Hair Loss Analysis',
  ],
  other: ['Consultation', 'Treatment', 'Service'],
};

// Organization Service table - services defined by the organization
export const organizationService = pgTable(
  'organization_service',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // Service details
    name: text('name').notNull(),
    description: text('description'),
    category: serviceCategoryEnum('category').notNull().default('treatment'),

    // Nullable: legacy services predate the categories table; the
    // backfill script populates this from the `category` enum but the
    // column stays nullable so deleting a category doesn't cascade-block.
    categoryId: text('category_id').references(
      () => organizationServiceCategory.id,
      { onDelete: 'set null' }
    ),

    // Ordering for UI display
    sortOrder: integer('sort_order').notNull().default(0),

    // Whether this is a custom service (not from defaults)
    isCustom: boolean('is_custom').notNull().default(false),

    // Whether this service is active
    isActive: boolean('is_active').notNull().default(true),

    // Deposit settings (per-service)
    //
    // DEPRECATED — `requiresDeposit` could express only two of the three real
    // states (`full` prepay had no representation at all) and had no way to say
    // "no deposit for THIS service" against an org-wide default: false means
    // "don't add mine", after which the org default applied anyway. Superseded
    // by `paymentPolicy` below; kept read-only through the transition.
    requiresDeposit: boolean('requires_deposit').notNull().default(false),
    depositAmountCents: integer('deposit_amount_cents'), // e.g. 5000 = €50

    // NULL = inherit the org default. `'in_clinic'` is a real opt-OUT, which is
    // what `requiresDeposit` could never express.
    paymentPolicy: servicePaymentPolicyEnum('payment_policy'),
    depositBasis: depositBasisEnum('deposit_basis'),
    // Whole percent of `priceCents`. Only meaningful where the price actually
    // resolves — `resolveBookingPayment` collects nothing on `from`/`poa`
    // rather than quietly under-charging against a floor.
    depositPercent: integer('deposit_percent'),

    // Content generation fields (used to auto-fill video scripts)
    painPoints: jsonb('pain_points').$type<string[]>(), // e.g. ["acne scarring", "uneven skin tone", "fine lines"]
    expectedResults: jsonb('expected_results').$type<string[]>(), // e.g. ["smoother skin", "reduced redness", "tighter pores"]
    processDescription: text('process_description'), // e.g. "using targeted laser energy to stimulate collagen production"
    targetArea: text('target_area'), // e.g. "face and neck"

    // DEPRECATED — the freeform price string ("€85 per session", "From £50",
    // "POA"). Being retired in favour of (priceType, priceCents [+ variants]);
    // kept read-only through the transition so the backfill and clinics can
    // re-enter the messy tail, then dropped. Never write to it in new code, and
    // derive display from `formatServicePrice`, not from this.
    // See docs/plans/service-pricing-model.md.
    priceText: text('price_text'),

    // How this service is priced. The display string is DERIVED from
    // (priceType, priceCents, variants) via formatServicePrice — never stored
    // freeform. Default 'poa' is the safe unmigrated state (shows "Price on
    // consultation", never a wrong number); the backfill sets the real value.
    priceType: servicePriceTypeEnum('price_type').notNull().default('poa'),

    // The anchor price in cents — all-in, tax-inclusive, in the ORG's currency
    // (derived from country, not stored per service). For `fixed` this IS the
    // price; for `from` it's the floor; for `free`/`poa` it's null. A service
    // with variants uses the min variant price as its "from" anchor.
    priceCents: integer('price_cents'),

    // Stripe tax-code override. Null means use the connected account's preset.
    taxCode: text('tax_code'),

    // Duration of whatever the customer books online (minutes).
    appointmentDuration: integer('appointment_duration'),

    // Cleanup/reset minutes the ROOM (and any other required resource) stays
    // held after this service ends. Opt-in: null/0 = no turnaround, which is
    // the pre-resource-scheduling behaviour. Does NOT extend the practitioner's
    // busy time — only the resource allocation. See schema/resource.ts.
    turnaroundMinutes: integer('turnaround_minutes'),

    // FOOTAGE SPEC — what this service looks like on camera.
    //
    // Body region(s) the treatment is performed on, from the controlled region
    // vocabulary. As load-bearing as the agent: eyebrow filler and lip filler
    // are the same syringe and completely different shots, and laser hair
    // removal splits into ~40 body-part variants across 20 orgs.
    //
    // Empty array means "not specified" — NOT "whole body". A service selling
    // at category level ("Microneedling", "Dermal Fillers") legitimately has no
    // region; the customer picks one at consultation. Those want a
    // region-neutral clip, which is a real answer, not a gap.
    regions: text('regions').array().notNull().default([]),

    // Where the footage spec came from. NOT NULL because it carries the
    // honesty: 'declared' means a human said so, 'inferred_from_name' means the
    // classifier guessed from the service name, 'unknown' means we don't know.
    //
    // The matcher reads this. Only 'declared' (and high-confidence
    // 'inferred_from_name') unlock exact-grade procedure clips; 'unknown' falls
    // through to ambient. This is why agent/region are NULLABLE — making them
    // required would force all 1,630 existing rows to receive a value at
    // migration time, i.e. a guess asserted as fact, which is the precise
    // failure this design exists to prevent.
    specSource: serviceSpecSourceEnum('spec_source')
      .notNull()
      .default('unknown'),

    // Generated sentence describing the shot this service wants, in the same
    // register clip descriptions use ("cannula or fine needle at the under-eye,
    // close-up, clinical"). THIS is what gets embedded for retrieval — not the
    // service name, which is unique-per-org 93% of the time and therefore
    // useless as a similarity key.
    expectedShot: text('expected_shot'),

    // pgvector embedding of `expectedShot`, compared against
    // stock_clip.embedding. Both sides are written in the same register on
    // purpose — comparing a service NAME to a clip description compares two
    // different kinds of text and produces a noisy cosine.
    //
    // Ranks WITHIN the gate's allowed set; it never decides eligibility. A
    // laser clip sits 0.331 from an RF clip in this space, closer than some RF
    // clips are to each other, so similarity cannot be trusted to separate
    // treatments — only the declared technique can.
    expectedShotEmbedding: vector('expected_shot_embedding', {
      dimensions: 1536,
    }),

    // The visually-distinguishable class this service is performed with.
    //
    // Held directly on the service rather than reached through
    // service_agent -> treatment_agent, because the agent axis is inert for
    // matching today: every stock clip has agent_slug NULL by constraint, so
    // the gate's agent branch cannot fire until own-shoot or pooled footage
    // exists. Routing technique through a join table would be two hops to
    // fetch one value.
    //
    // NULLABLE on purpose. A service whose name carries no treatment
    // information ("Body Contouring", "Barrier Repair") must stay null and
    // fall through to ambient — asserting a guess here is the exact failure
    // the design exists to prevent. `specSource` carries how it was set.
    techniqueSlug: text('technique_slug').references(() => technique.slug, {
      onDelete: 'restrict',
    }),

    // When the classifier last RAN for this row — not when it last succeeded in
    // naming a technique.
    //
    // Needed because null is a legitimate RESULT. "Anti-Ageing" is correctly
    // classified to no technique, so `technique_slug IS NULL` cannot distinguish
    // "never asked" from "asked, and the honest answer was nothing". Without
    // this column the matcher re-runs two LLM calls for every vague service on
    // every job, forever, and the backfill re-reads rows it has already settled.
    //
    // `spec_source` cannot serve instead: it DEFAULTS to 'unknown' and is also
    // WRITTEN as 'unknown' for a null classification, so the two states are
    // indistinguishable there too.
    techniqueClassifiedAt: timestamp('technique_classified_at'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Unique constraint: service name must be unique within an organization
    unique('organization_service_name_unique').on(
      table.organizationId,
      table.name
    ),
  ]
);

export const organizationServiceRlsPolicy = orgRlsPolicy(organizationService);

/**
 * organization_service_location — which branches offer a service, and at what
 * price/duration there.
 *
 * A JOIN table, not a `location_id` column, because a chain offers one
 * catalogue entry at N of its branches at the same time. Duplicating the
 * service row per branch (the Fresha model) is not viable here:
 * `organization_service.id` is referenced by 18 other tables, so cloning rows
 * would mean repointing every one of those FKs on live data. The join is
 * additive — existing service ids never move.
 *
 * The join row is also the ONLY place per-branch overrides can live ("Botox is
 * €250 in Dublin, €220 in Cork"). NULL override = inherit the service row,
 * which keeps the `price_type`/`price_cents` model on the parent intact.
 *
 * ZERO rows for a service means "offered everywhere" (same convention as
 * `blocked_time_practitioner`), so this lands without a backfill for
 * single-location orgs.
 */
export const organizationServiceLocation = pgTable(
  'organization_service_location',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    serviceId: text('service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => organizationLocation.id, { onDelete: 'cascade' }),

    // NULL = inherit the service row's price / duration at this branch.
    priceCentsOverride: integer('price_cents_override'),
    durationMinutesOverride: integer('duration_minutes_override'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('organization_service_location_unique').on(
      table.serviceId,
      table.locationId
    ),
    index('idx_organization_service_location_location_id').on(table.locationId),
  ]
);

// Bucket B2: join table (organization_service ↔ organization_location). Both
// parents are org-scoped; routed via service_id because organization_service
// has organization_id indexed and is the owning side of the catalogue.
export const organizationServiceLocationRlsPolicy = joinRlsPolicy(
  organizationServiceLocation,
  {
    parent: 'organization_service',
    fk: 'service_id',
  }
);

export const organizationServiceLocationRelations = relations(
  organizationServiceLocation,
  ({ one }) => ({
    service: one(organizationService, {
      fields: [organizationServiceLocation.serviceId],
      references: [organizationService.id],
    }),
    location: one(organizationLocation, {
      fields: [organizationServiceLocation.locationId],
      references: [organizationLocation.id],
    }),
  })
);

/**
 * organization_service_variant_location — per-branch price for ONE variant.
 *
 * WHY THIS EXISTS SEPARATELY from `organization_service_location`. That row is
 * keyed on (service, location) and carries the SERVICE's price override. A
 * variant-priced service ("1 Area" / "2 Areas" / "3 Areas") does not have one
 * price to override — `organization_service.price_cents` is a "from", and what
 * a customer actually pays is the VARIANT's price. So a branch that charges
 * differently for Botox needs a row per option, not one row for the service.
 *
 * Without this, a branch override on a variant-priced service is either
 * ignored (the variant list still shows org prices) or actively misleading
 * (the "from" moves but the options it summarises do not). Both are the same
 * wrong-price class the service-level override exists to prevent.
 *
 * ZERO rows means "this branch charges the variant's own price" — the same
 * inherit-by-absence convention as every other location join table, so this
 * lands empty and changes nothing until someone sets a price.
 *
 * No `durationMinutesOverride` here: the variant already carries its own
 * `durationMinutes`, and a per-branch duration for one option of one service
 * is a level of granularity nobody has asked for. Price is the thing that
 * differs between branches.
 */
export const organizationServiceVariantLocation = pgTable(
  'organization_service_variant_location',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    variantId: text('variant_id')
      .notNull()
      .references(() => organizationServiceVariant.id, { onDelete: 'cascade' }),
    // The variant's OWNING service, carried here purely so RLS can route.
    //
    // `organization_service_variant` has no `organization_id` of its own, so a
    // one-hop `joinRlsPolicy` through it would generate a policy referencing a
    // column that does not exist. Routing through the service — which does
    // carry it, and is exactly how `organization_service_location` routes —
    // reuses the hardened helper instead of hand-rolling a two-hop policy.
    //
    // Cannot drift: the write path derives it from the variant row rather than
    // taking it from the caller, and a variant never changes service.
    serviceId: text('service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => organizationLocation.id, { onDelete: 'cascade' }),

    // NULL is not a meaningful state here — a row exists precisely to state a
    // price — but the column stays nullable to match the service-level
    // override's shape, where NULL means "inherit".
    priceCentsOverride: integer('price_cents_override'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('organization_service_variant_location_unique').on(
      table.variantId,
      table.locationId
    ),
    index('idx_org_service_variant_location_location_id').on(table.locationId),
  ]
);

// Join table (organization_service_variant <-> organization_location). Routed
// via service_id — see the column's note for why not variant_id.
export const organizationServiceVariantLocationRlsPolicy = joinRlsPolicy(
  organizationServiceVariantLocation,
  {
    parent: 'organization_service',
    fk: 'service_id',
  }
);

export const organizationServiceVariantLocationRelations = relations(
  organizationServiceVariantLocation,
  ({ one }) => ({
    variant: one(organizationServiceVariant, {
      fields: [organizationServiceVariantLocation.variantId],
      references: [organizationServiceVariant.id],
    }),
    location: one(organizationLocation, {
      fields: [organizationServiceVariantLocation.locationId],
      references: [organizationLocation.id],
    }),
  })
);

export type OrganizationServiceVariantLocation =
  typeof organizationServiceVariantLocation.$inferSelect;
export type NewOrganizationServiceVariantLocation =
  typeof organizationServiceVariantLocation.$inferInsert;

export type OrganizationServiceLocation =
  typeof organizationServiceLocation.$inferSelect;
export type NewOrganizationServiceLocation =
  typeof organizationServiceLocation.$inferInsert;

/**
 * service_agent — which machine(s) or product(s) a service uses.
 *
 * MANY-TO-MANY, not a column on organization_service, because packages are real
 * and common in the production catalogue:
 *   "Emsculpt + Endymed combo", "Sculpting and Cavitation Combo",
 *   "3 in 1 Body Sculpting Special", "Lymphatic Reset" (massage + red light +
 *   sauna), "Full Face Glow Package - 5ml filler, Tox and Skin Booster".
 * A single agent_slug cannot express any of these. The matcher gates on ANY
 * linked agent and ranks by the primary one.
 *
 * A service with NO rows here has an unknown agent. That is a legitimate,
 * common state (see organization_service.spec_source) and the matcher handles
 * it by falling back to technique grade, or to ambient when the technique is
 * also unknown. It is never treated as "no agent required".
 */
export const serviceAgent = pgTable(
  'service_agent',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    organizationServiceId: text('organization_service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),

    agentSlug: text('agent_slug')
      .notNull()
      .references(() => treatmentAgent.slug, { onDelete: 'restrict' }),

    /**
     * The headline agent for a package — used for ranking and for the
     * generated `expected_shot`. Exactly one row per service should be
     * primary; the rest are still gate-eligible.
     */
    isPrimary: boolean('is_primary').notNull().default(false),

    /**
     * Mirrors organization_service.spec_source for THIS link specifically.
     * A service can have one declared agent and one inferred, e.g. when a
     * clinic confirms "Emsculpt" on a combo service but the "Endymed" half was
     * only ever guessed from the name.
     */
    source: text('source')
      .$type<'declared' | 'inferred_from_name'>()
      .notNull()
      .default('inferred_from_name'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('service_agent_unique').on(
      table.organizationServiceId,
      table.agentSlug
    ),
    index('idx_service_agent_service').on(table.organizationServiceId),
    index('idx_service_agent_agent').on(table.agentSlug),
  ]
);

// Bucket B1: no organization_id of its own; org scope derives from the parent
// organization_service row. treatment_agent is global reference data.
export const serviceAgentRlsPolicy = childOrgRlsPolicy(serviceAgent, {
  parent: 'organization_service',
  fk: 'organization_service_id',
});

export const serviceAgentRelations = relations(serviceAgent, ({ one }) => ({
  service: one(organizationService, {
    fields: [serviceAgent.organizationServiceId],
    references: [organizationService.id],
  }),
  agent: one(treatmentAgent, {
    fields: [serviceAgent.agentSlug],
    references: [treatmentAgent.slug],
  }),
}));

export type ServiceAgent = typeof serviceAgent.$inferSelect;
export type NewServiceAgent = typeof serviceAgent.$inferInsert;

// Asset Service junction table - many-to-many relationship
export const assetService = pgTable(
  'asset_service',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    assetId: text('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),

    // Confidence score from AI analysis (0-1)
    confidence: real('confidence'),

    // Whether this link was auto-generated by AI
    isAutoGenerated: boolean('is_auto_generated').notNull().default(false),

    /**
     * Whether the image ACTUALLY DEPICTS this service, judged by looking at it.
     *
     * `confidence` above is the tagging classifier's own score, and it cannot
     * catch its own mistakes: a coffee-scrub clip was linked to "Deep Steam
     * Facial 60 Mins" at 0.8 — the highest of the three services it was tagged
     * with — and the graphic built from it described an "aromatic coffee scrub"
     * as part of the facial. No threshold on that column separates it from the
     * good links, because the classifier was confident and wrong.
     *
     * So this is a SECOND opinion from a different kind of evidence: the pixels
     * next to the service name. Null means unchecked; the check runs lazily on
     * the asset selection actually reaches and is cached here, so it costs at
     * most one vision call per link and nothing once warm.
     */
    depictsService: boolean('depicts_service'),
    /** When `depictsService` was last decided. Null = never checked. */
    depictsCheckedAt: timestamp('depicts_checked_at'),

    /**
     * When this asset was last used to illustrate this service, and how often.
     *
     * Selection claims the least-recently-used eligible asset and stamps it in
     * the same statement, so consecutive generations cycle through the
     * service's media instead of repeatedly picking the newest. Spacing then
     * falls out of the pool size: three eligible photos means the same one
     * cannot reappear until three graphics later.
     *
     * Deliberately on the LINK, not the asset: an asset shared by two services
     * should rotate independently for each, and "last used" is only meaningful
     * relative to the service it was illustrating.
     *
     * NULL `lastUsedAt` sorts first — never-used media is always preferred.
     */
    lastUsedAt: timestamp('last_used_at'),
    useCount: integer('use_count').notNull().default(0),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // Unique constraint: one link per asset-service pair
    unique('asset_service_unique').on(table.assetId, table.serviceId),
    index('idx_asset_service_service_id').on(table.serviceId),
    // The claim query's ORDER BY — least-recently-used within one service.
    index('idx_asset_service_rotation').on(table.serviceId, table.lastUsedAt),
  ]
);

// Service Stock Clip — resolve-once cache of the semantic match between an
// organization_service and the global stock_clip catalog. Written by the matcher
// (once per service on create/update + backfill), read by the selector at video
// creation to auto-fill b-roll. See docs/implementations/stock-footage-library.md.
export const serviceStockClip = pgTable(
  'service_stock_clip',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationServiceId: text('organization_service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),
    stockClipId: text('stock_clip_id')
      .notNull()
      .references(() => stockClip.id, { onDelete: 'cascade' }),

    // Ordering within the matched set for this service.
    rank: integer('rank').notNull().default(0),

    // Match confidence (0–1). Drives the generic-fallback threshold: a weak top
    // score makes the selector draw from the generic pool instead.
    score: real('score'),

    // Manual override for high-value services — the matcher never overwrites a
    // pinned row.
    isPinned: boolean('is_pinned').notNull().default(false),

    resolvedAt: timestamp('resolved_at').notNull().defaultNow(),
  },
  (table) => [
    unique('service_stock_clip_unique').on(
      table.organizationServiceId,
      table.stockClipId
    ),
    index('idx_service_stock_clip_service').on(table.organizationServiceId),
  ]
);

// Bucket B1: no organization_id of its own; org scope derives from the parent
// organization_service row via organization_service_id. stock_clip is global.
export const serviceStockClipRlsPolicy = childOrgRlsPolicy(serviceStockClip, {
  parent: 'organization_service',
  fk: 'organization_service_id',
});

// Quality flags for asset assessment
export interface QualityFlags {
  isShaky?: boolean;
  isBlurry?: boolean;
  isPoorLighting?: boolean;
  showsOnlyEquipment?: boolean;
  isTooShort?: boolean;
}

// Analysis result type for JSONB storage
export interface AssetAnalysisResult {
  description: string;
  contentType: AssetContentType;
  matchedServices: Array<{
    serviceName: string;
    serviceId?: string;
    confidence: number;
  }>;
  suggestedTags: string[];
  frameCount: number;
  modelUsed: string;
  processingTimeMs: number;
  actionSegments?: Array<{
    startSec: number;
    endSec: number;
    label: 'action' | 'transition' | 'idle';
    description?: string;
  }>;
  /** Video duration in seconds (from ffprobe metadata) */
  videoDurationSec?: number;
  /** Quality score from 0 (unusable) to 1 (excellent) */
  qualityScore?: number;
  /** Specific quality issues detected */
  qualityFlags?: QualityFlags;
}

// Asset Analysis table - tracks AI analysis jobs
export const assetAnalysis = pgTable('asset_analysis', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  assetId: text('asset_id')
    .notNull()
    .references(() => asset.id, { onDelete: 'cascade' })
    .unique(), // One analysis per asset

  // Analysis status
  status: assetAnalysisStatusEnum('status').notNull().default('queued'),

  // AI-generated content type classification
  contentType: assetContentTypeEnum('content_type'),

  // Full analysis result stored as JSON
  analysisResult: jsonb('analysis_result').$type<AssetAnalysisResult>(),

  // Error tracking
  errorMessage: text('error_message'),

  // Timestamps
  queuedAt: timestamp('queued_at').notNull().defaultNow(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
});

// Relations
export const organizationServiceRelations = relations(
  organizationService,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [organizationService.organizationId],
      references: [organization.id],
    }),
    category: one(organizationServiceCategory, {
      fields: [organizationService.categoryId],
      references: [organizationServiceCategory.id],
    }),
    assetServices: many(assetService),
    variants: many(organizationServiceVariant),
    serviceStockClips: many(serviceStockClip),
    serviceLocations: many(organizationServiceLocation),
    // metaAdServices relation defined in meta-ads.ts to avoid circular imports
  })
);

/**
 * OrganizationServiceVariant — an OPTIONAL customer-chosen pricing option on a
 * service ("1 Area", "3 sessions", "60 min"). Only the ~8% of services with
 * genuine multi-point pricing have variants; the other 92% price entirely on
 * the service row. See docs/plans/service-pricing-model.md.
 *
 * A variant is ONE axis — a thing the customer picks. It is deliberately NOT
 * keyed on practitioner: senior-vs-junior pricing is out of scope (a clinic
 * that needs it makes separate services), so there is no price matrix.
 *
 * Colocated with `organizationService` (rather than its own file) because the
 * relation is mutual (`service.variants` ↔ `variant.service`) and a separate
 * module would be a circular import — same reason `appointment_service` lives
 * next to `appointment`.
 */
export const organizationServiceVariant = pgTable(
  'organization_service_variant',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    serviceId: text('service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),

    // The variant's price, in cents — all-in, tax-inclusive, org currency.
    // Nullable so a clinic can add an option before pricing it.
    priceCents: integer('price_cents'),

    // Overrides the service's default appointment duration when set; null = use
    // the service default. (A "3 sessions" variant may run longer than "1".)
    durationMinutes: integer('duration_minutes'),

    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('organization_service_variant_name_unique').on(
      table.serviceId,
      table.name
    ),
    index('idx_organization_service_variant_service_id').on(table.serviceId),
  ]
);

export const organizationServiceVariantRelations = relations(
  organizationServiceVariant,
  ({ one }) => ({
    service: one(organizationService, {
      fields: [organizationServiceVariant.serviceId],
      references: [organizationService.id],
    }),
  })
);

// Bucket B child table: org scope inherited from `organization_service` (which
// carries organization_id), same pattern as assetAnalysis / appointment_service.
export const organizationServiceVariantRlsPolicy = childOrgRlsPolicy(
  organizationServiceVariant,
  { parent: 'organization_service', fk: 'service_id' }
);

export const assetServiceRelations = relations(assetService, ({ one }) => ({
  asset: one(asset, {
    fields: [assetService.assetId],
    references: [asset.id],
  }),
  service: one(organizationService, {
    fields: [assetService.serviceId],
    references: [organizationService.id],
  }),
}));

export const serviceStockClipRelations = relations(
  serviceStockClip,
  ({ one }) => ({
    service: one(organizationService, {
      fields: [serviceStockClip.organizationServiceId],
      references: [organizationService.id],
    }),
    stockClip: one(stockClip, {
      fields: [serviceStockClip.stockClipId],
      references: [stockClip.id],
    }),
  })
);

export const assetAnalysisRelations = relations(assetAnalysis, ({ one }) => ({
  asset: one(asset, {
    fields: [assetAnalysis.assetId],
    references: [asset.id],
  }),
}));

// =============================================================================
// RLS POLICIES (Bucket B — W-GLOBAL)
// =============================================================================

// Bucket B1: asset_analysis has no organization_id; org scope derives from the
// parent asset row via asset_id FK. asset has organization_id (Bucket A).
export const assetAnalysisRlsPolicy = childOrgRlsPolicy(assetAnalysis, {
  parent: 'asset',
  fk: 'asset_id',
});

// Bucket B2: asset_service is a join table (asset ↔ organization_service). Both
// parents are org-scoped. We route via asset_id because the asset table has an
// idx_asset_org_id index, making the EXISTS predicate cheaper than going via the
// service side.
export const assetServiceRlsPolicy = joinRlsPolicy(assetService, {
  parent: 'asset',
  fk: 'asset_id',
});

// Types
export type OrganizationService = typeof organizationService.$inferSelect;
export type NewOrganizationService = typeof organizationService.$inferInsert;
export type OrganizationServiceVariant =
  typeof organizationServiceVariant.$inferSelect;
export type NewOrganizationServiceVariant =
  typeof organizationServiceVariant.$inferInsert;
export type AssetService = typeof assetService.$inferSelect;
export type NewAssetService = typeof assetService.$inferInsert;
export type ServiceStockClip = typeof serviceStockClip.$inferSelect;
export type NewServiceStockClip = typeof serviceStockClip.$inferInsert;
export type AssetAnalysis = typeof assetAnalysis.$inferSelect;
export type NewAssetAnalysis = typeof assetAnalysis.$inferInsert;
