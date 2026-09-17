import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { joinRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { bookingAccount } from './booking-accounts.js';
import { calendarAccount } from './calendar-accounts.js';
import { organizationLocation } from './organization-location.js';
import { organizationService } from './organization-service.js';
import { countryEnum, organization } from './organization.js';
import { user, userColorEnum } from './user.js';

// Re-export employment type labels/type for consumers
export { employmentTypeLabels } from '@borradh-workspace/labels';
export type { EmploymentType } from '@borradh-workspace/labels';

// Employment type enum (practitioner work details)
// Declared on `user`, which now owns the staff profile. Re-exported here so
// existing importers of this module keep working.
import { employmentTypeEnum } from './user.js';
export { employmentTypeEnum };

/**
 * Practitioner social links (public profile, self-onboarding wizard).
 */
export type PractitionerSocialLinks = {
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  [k: string]: string | undefined;
};

/**
 * Working hours shape for practitioners and practitioner-location overrides.
 * Keys are day-of-week (0=Sunday..6=Saturday), values are time ranges in minutes from midnight.
 * Same format as organization.businessHours.
 */
export type WorkingHours = Record<number, { from: number; to: number }>;

// Practitioner table - staff who take bookings
export const practitioner = pgTable(
  'practitioner',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),

    // Profile
    name: text('name').notNull(),
    // First/last name (nullable for now — existing rows have only `name`).
    // `name` kept as the derived/combined display value for back-compat.
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email').notNull(),
    phone: text('phone'),
    phoneSecondary: text('phone_secondary'),
    phoneCountry: text('phone_country'),
    country: countryEnum('country'),
    photo: text('photo'),
    bio: text('bio'),
    title: text('title'), // e.g., "Senior Stylist"
    // Public-profile headline (self-onboarding wizard, distinct from `title`)
    headline: text('headline'),
    dateOfBirth: date('date_of_birth'),

    // Work details
    employmentStartDate: date('employment_start_date'),
    employmentEndDate: date('employment_end_date'),
    employmentType: employmentTypeEnum('employment_type'),
    teamMemberRef: text('team_member_ref'), // external/payroll identifier
    notes: text('notes'),

    // Booking / public profile
    acceptsBookings: boolean('accepts_bookings').notNull().default(true),
    languages: text('languages').array(),
    socialLinks: jsonb('social_links').$type<PractitionerSocialLinks>(),

    // Status
    isActive: boolean('is_active').notNull().default(true),
    /**
     * This person was INVITED and has not accepted yet (ENG-794).
     *
     * "Add team member" creates the practitioner row first and the invitation
     * last, and the row lands with `is_active = true` / `accepts_bookings =
     * true` plus a seeded 09:00–17:00 weekly shift. Since shifts are the SOLE
     * source of working time, an invitee was instantly a full calendar column
     * with real availability — bookable by staff and offered to customers —
     * while the team list still read "Invited".
     *
     * Why a column rather than deriving it from `user_id IS NULL`: that is what
     * the STATUS BADGE derives from, but it does not mean the same thing.
     * Practitioners added by the onboarding wizard were never emailed at all
     * and also have no `user_id`; gating bookability on it would have made
     * every one of them non-bookable overnight. Only the invite flow sets this
     * flag, and accepting the invitation clears it, so "never invited" and
     * "invited, hasn't accepted" stay distinguishable.
     *
     * DEFAULT false so every path that does not opt in — the onboarding
     * wizard, imports, `ensureDefaultPractitioner` — keeps behaving exactly as
     * it did.
     */
    invitationPending: boolean('invitation_pending').notNull().default(false),
    profileSetupCompleted: boolean('profile_setup_completed')
      .notNull()
      .default(false),

    // Calendar integration
    calendarAccountId: text('calendar_account_id').references(
      () => calendarAccount.id,
      { onDelete: 'set null' }
    ),

    // Booking system integration
    bookingAccountId: text('booking_account_id').references(
      () => bookingAccount.id,
      { onDelete: 'set null' }
    ),
    externalBookingId: text('external_booking_id'), // Calendly user URI, Timely staff ID, etc.
    bookingLink: text('booking_link'), // Per-practitioner booking URL for Tier 2/3

    // Default working hours (overridden by per-location hours)
    /** @deprecated replaced by shift table */
    workingHours: jsonb('working_hours').$type<WorkingHours>(),

    // Calendar tint color, unique per organization. Auto-picked on practitioner
    // create from the first unused value in the userColor palette; users can
    // change it later from settings.
    color: userColorEnum('color'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    uniqueIndex('practitioner_org_email_unique')
      .on(table.organizationId, table.email)
      .where(sql`${table.deletedAt} IS NULL`),
    index('idx_practitioner_user_id').on(table.userId),
    index('idx_practitioner_calendar_account_id').on(table.calendarAccountId),
    index('idx_practitioner_booking_account_id').on(table.bookingAccountId),
  ]
);

export const practitionerRlsPolicy = orgRlsPolicy(practitioner);

// Practitioner-Location junction table with per-location working hours
// NOTE: practitionerLocation (B2 join table) and practitionerService (B2 join table)
// do NOT have organization_id — their RLS policies are owned by W-GLOBAL.
export const practitionerLocation = pgTable(
  'practitioner_location',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    practitionerId: text('practitioner_id')
      .notNull()
      .references(() => practitioner.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => organizationLocation.id, { onDelete: 'cascade' }),

    // Per-location working hours (null = inherit practitioner or org hours)
    /** @deprecated replaced by shift table */
    workingHours: jsonb('working_hours').$type<WorkingHours>(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('practitioner_location_unique').on(
      table.practitionerId,
      table.locationId
    ),
    index('idx_practitioner_location_location_id').on(table.locationId),
  ]
);

// Practitioner-Service junction table
export const practitionerService = pgTable(
  'practitioner_service',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    practitionerId: text('practitioner_id')
      .notNull()
      .references(() => practitioner.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('practitioner_service_unique').on(
      table.practitionerId,
      table.serviceId
    ),
    index('idx_practitioner_service_service_id').on(table.serviceId),
  ]
);

// Relations
export const practitionerRelations = relations(
  practitioner,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [practitioner.organizationId],
      references: [organization.id],
    }),
    user: one(user, {
      fields: [practitioner.userId],
      references: [user.id],
    }),
    calendarAccount: one(calendarAccount, {
      fields: [practitioner.calendarAccountId],
      references: [calendarAccount.id],
    }),
    bookingAccountRel: one(bookingAccount, {
      fields: [practitioner.bookingAccountId],
      references: [bookingAccount.id],
    }),
    locations: many(practitionerLocation),
    services: many(practitionerService),
  })
);

export const practitionerLocationRelations = relations(
  practitionerLocation,
  ({ one }) => ({
    practitioner: one(practitioner, {
      fields: [practitionerLocation.practitionerId],
      references: [practitioner.id],
    }),
    location: one(organizationLocation, {
      fields: [practitionerLocation.locationId],
      references: [organizationLocation.id],
    }),
  })
);

export const practitionerServiceRelations = relations(
  practitionerService,
  ({ one }) => ({
    practitioner: one(practitioner, {
      fields: [practitionerService.practitionerId],
      references: [practitioner.id],
    }),
    service: one(organizationService, {
      fields: [practitionerService.serviceId],
      references: [organizationService.id],
    }),
  })
);

// =============================================================================
// RLS POLICIES (Bucket B2 — W-GLOBAL)
// =============================================================================

// practitioner_location: join table (practitioner ↔ organization_location).
// Both parents are org-scoped. Route via practitioner_id — practitioner has
// organization_id (idx_practitioner_org_id) and is the smaller side.
export const practitionerLocationRlsPolicy = joinRlsPolicy(
  practitionerLocation,
  {
    parent: 'practitioner',
    fk: 'practitioner_id',
  }
);

// practitioner_service: join table (practitioner ↔ organization_service).
// ⚠️  W-BOOK dependency: the public booking flow reads this table to show which
// services a practitioner offers. The default `to` list includes app_public
// so that the slug-bootstrapped booking session can read it without error.
// Both parents are org-scoped. Route via practitioner_id (same reasoning).
export const practitionerServiceRlsPolicy = joinRlsPolicy(practitionerService, {
  parent: 'practitioner',
  fk: 'practitioner_id',
});

// Types
export type Practitioner = typeof practitioner.$inferSelect;
export type NewPractitioner = typeof practitioner.$inferInsert;
export type PractitionerLocation = typeof practitionerLocation.$inferSelect;
export type NewPractitionerLocation = typeof practitionerLocation.$inferInsert;
export type PractitionerService = typeof practitionerService.$inferSelect;
export type NewPractitionerService = typeof practitionerService.$inferInsert;
