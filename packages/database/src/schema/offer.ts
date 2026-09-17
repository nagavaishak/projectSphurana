import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { joinRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { organizationLocation } from './organization-location.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';

// Import labels from enums (pure TypeScript)
import {
  offerDiscountTypeLabels,
  offerDiscountTypeValues,
  offerStateLabels,
  offerStateValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  offerDiscountTypeLabels,
  offerDiscountTypeValues,
  offerStateLabels,
  offerStateValues,
};
export type {
  OfferDiscountType,
  OfferState,
} from '@borradh-workspace/labels';

// Database enums
export const offerStateEnum = pgEnum('offer_state', offerStateValues);
export const offerDiscountTypeEnum = pgEnum(
  'offer_discount_type',
  offerDiscountTypeValues
);

/**
 * Offer table - reusable offers consumed by ads, videos, and bulk messaging.
 *
 * Shape note: the discount-related columns are populated according to
 * `discountType`. Only the columns relevant to the chosen discount type
 * are filled; the rest are null. Enforcement happens at the Zod layer.
 */
export const offer = pgTable(
  'offer',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    /** Operator-facing notes shown in the promotion editor. Never on the wire
     *  to customers — the booking page renders `name` and the discount. */
    description: text('description'),
    code: text('code'),

    state: offerStateEnum('state').notNull().default('active'),

    validFrom: timestamp('valid_from'),
    validUntil: timestamp('valid_until'),

    // Discriminated discount fields — populated per `discountType`.
    // New (Figma redesign): use `discountAmountCents` for `fixed_amount`.
    // Legacy: `originalPriceCents` / `offerPriceCents` (fixed_price) and
    // `buyQuantity` / `getQuantity` (buy_x_get_y) are kept for back-compat
    // with rows created against the previous shape.
    discountType: offerDiscountTypeEnum('discount_type').notNull(),
    discountPercent: integer('discount_percent'),
    discountAmountCents: integer('discount_amount_cents'),
    originalPriceCents: integer('original_price_cents'),
    offerPriceCents: integer('offer_price_cents'),
    buyQuantity: integer('buy_quantity'),
    getQuantity: integer('get_quantity'),

    // Redemption rules
    limitPerClient: boolean('limit_per_client').notNull().default(false),
    redemptionLimit: integer('redemption_limit'),
    redemptionCount: integer('redemption_count').notNull().default(0),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_offer_org_id').on(table.organizationId),
    index('idx_offer_state').on(table.state),
    uniqueIndex('idx_offer_org_code_unique')
      .on(table.organizationId, sql`lower(${table.code})`)
      .where(sql`${table.code} IS NOT NULL AND ${table.deletedAt} IS NULL`),
  ]
);

export const offerRlsPolicy = orgRlsPolicy(offer);

/**
 * Offer-Service junction table (many-to-many)
 */
export const offerService = pgTable(
  'offer_service',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    offerId: text('offer_id')
      .notNull()
      .references(() => offer.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('offer_service_unique').on(table.offerId, table.serviceId),
    index('idx_offer_service_service_id').on(table.serviceId),
  ]
);

/**
 * Offer-Location junction table (many-to-many).
 *
 * Empty = applies to all org locations. Non-empty = restricted to the
 * listed locations.
 */
export const offerLocation = pgTable(
  'offer_location',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    offerId: text('offer_id')
      .notNull()
      .references(() => offer.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => organizationLocation.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('offer_location_unique').on(table.offerId, table.locationId),
    index('idx_offer_location_location_id').on(table.locationId),
  ]
);

// Relations
export const offerRelations = relations(offer, ({ one, many }) => ({
  organization: one(organization, {
    fields: [offer.organizationId],
    references: [organization.id],
  }),
  offerServices: many(offerService),
  offerLocations: many(offerLocation),
}));

export const offerServiceRelations = relations(offerService, ({ one }) => ({
  offer: one(offer, {
    fields: [offerService.offerId],
    references: [offer.id],
  }),
  service: one(organizationService, {
    fields: [offerService.serviceId],
    references: [organizationService.id],
  }),
}));

export const offerLocationRelations = relations(offerLocation, ({ one }) => ({
  offer: one(offer, {
    fields: [offerLocation.offerId],
    references: [offer.id],
  }),
  location: one(organizationLocation, {
    fields: [offerLocation.locationId],
    references: [organizationLocation.id],
  }),
}));

// Bucket B2: offer_service is a join table (offer ↔ organization_service).
// Both parents are org-scoped. We route via offer_id because offer has
// organization_id and is the natural "owner" side of this relationship.
export const offerServiceRlsPolicy = joinRlsPolicy(offerService, {
  parent: 'offer',
  fk: 'offer_id',
});

// Bucket B2: offer_location is a join table (offer ↔ organization_location).
// Both parents are org-scoped. We route via offer_id (same reasoning as above).
export const offerLocationRlsPolicy = joinRlsPolicy(offerLocation, {
  parent: 'offer',
  fk: 'offer_id',
});

// Types
export type Offer = typeof offer.$inferSelect;
export type NewOffer = typeof offer.$inferInsert;
export type OfferService = typeof offerService.$inferSelect;
export type NewOfferService = typeof offerService.$inferInsert;
export type OfferLocation = typeof offerLocation.$inferSelect;
export type NewOfferLocation = typeof offerLocation.$inferInsert;
