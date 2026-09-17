import type { VenueAmenity } from '@borradh-workspace/labels';
import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { countryEnum, organization } from './organization.js';

/**
 * Per-day-of-week opening hours for a location.
 * Keys: 0=Sunday..6=Saturday. Values in minutes from midnight.
 * Day key omitted (or from===to) means closed that day.
 * Shape matches packages/database/src/schema/practitioners.ts WorkingHours.
 */
export type LocationOpeningHours = Record<number, { from: number; to: number }>;

// Organization Location table - multiple physical locations per organization
export const organizationLocation = pgTable(
  'organization_location',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // Address fields
    name: text('name'), // e.g., "Main Clinic", "Dublin Branch"
    addressLine1: text('address_line_1').notNull(),
    addressLine2: text('address_line_2'),
    city: text('city').notNull(),
    county: text('county'), // State/Province/County
    postalCode: text('postal_code'),
    country: countryEnum('country').notNull(),

    // Geocoding
    latitude: real('latitude'),
    longitude: real('longitude'),

    // Standing weekly opening hours. Null = inherit org.businessHours.
    // One-off overrides live in organization_location_opening_hours_exception.
    openingHours: jsonb('opening_hours').$type<LocationOpeningHours>(),

    // Stripe Terminal Location (`tml_...`), lazily created from this
    // location's address on first Terminal use (see StripeConnectService).
    stripeTerminalLocationId: text('stripe_terminal_location_id'),

    // --- Public venue page (a venue IS a location) ---------------------------
    // Per-branch URL slug, used by BOTH public URLs (/book/:orgSlug/:locationSlug)
    // and the dashboard (/dashboard/l/:slug/...).
    //
    // UNIQUE PER ORG, not globally. It was global, and that made readable slugs
    // impossible to generate: every tenant with a "Dublin" or "Main Street"
    // branch collided with every other, so a name-derived slug had to become
    // `dublin-7` — less readable than the id it replaced, and a leak of how many
    // other customers picked that name. Both consumers already scope by org (the
    // public URL carries :orgSlug, the dashboard carries the session), so
    // per-org uniqueness is the correct grain and the global one was simply
    // over-strict.
    //
    // Still nullable at the column level; `generateLocationSlug` fills it on
    // create and the backfill fills existing rows. Tightening to NOT NULL is a
    // follow-up once prod is clean (see scripts/backfill-location-slugs.ts).
    slug: text('slug'),
    // The "About" prose this branch shows a customer deciding whether to book.
    // NOT organization.credibilityLine / targetAudienceDescription (AI ad copy).
    about: text('about'),
    // Perks under "Additional information" (pet-friendly, LGBTQ+, …). Keys come
    // from venueAmenityLabels in @borradh-workspace/labels.
    amenities: jsonb('amenities').$type<VenueAmenity[]>().default([]).notNull(),

    // Metadata
    isPrimary: boolean('is_primary').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_org_location_org_id').on(table.organizationId),
    unique('organization_location_org_slug_unique').on(
      table.organizationId,
      table.slug
    ),
  ]
);

export const organizationLocationRlsPolicy = orgRlsPolicy(organizationLocation);

// NOTE: org_location_opening_hours_exception has no organization_id (Bucket B1).
// Its RLS policy (EXISTS join to organizationLocation) is owned by W-GLOBAL.

// Relations
export const organizationLocationRelations = relations(
  organizationLocation,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationLocation.organizationId],
      references: [organization.id],
    }),
  })
);

// Types
export type OrganizationLocation = typeof organizationLocation.$inferSelect;
export type NewOrganizationLocation = typeof organizationLocation.$inferInsert;
