import {
  employmentTypeValues,
  userColorLabels,
  userColorValues,
} from '@borradh-workspace/labels';
import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { countryEnum, organization } from './organization.js';

export { userColorLabels, userColorValues };
export type { UserColor } from '@borradh-workspace/labels';

// The `user_color` enum is used by practitioner.color (org-scoped tint).
// Kept named `user_color` for now to avoid a redundant enum rename migration.
export const userColorEnum = pgEnum('user_color', userColorValues);

// Employment type (staff work details). Defined here rather than in
// practitioners.ts because `user` now owns these columns and that file is being
// retired; practitioners.ts re-exports these for the duration of the migration.
export const employmentTypeEnum = pgEnum(
  'employment_type',
  employmentTypeValues
);

/** Staff social links (public profile, self-onboarding wizard). */
export type UserSocialLinks = {
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  [k: string]: string | undefined;
};

export const user = pgTable('user', {
  // Better Auth supplies its own id when IT creates the row. The default is for
  // the other way in: staff created by the app (a team member with no login,
  // an import from an external booking system) — `practitioner.id` had one for
  // exactly that reason, and creating staff must not become harder than it was.
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  currency: text('currency').default('USD'),
  timezone: text('timezone').default('UTC'),
  // Better Auth admin plugin fields
  role: text('role').$type<'user' | 'admin'>().default('user'),
  banned: boolean('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: integer('ban_expires'),
  // Better Auth two-factor plugin field
  twoFactorEnabled: boolean('two_factor_enabled').default(false),

  // ── Org membership (absorbed from `member`) ────────────────────────────────
  // A user belongs to exactly ONE organization. This replaces the `member`
  // join table and the session's mutable `activeOrganizationId`: org is a
  // property of the person, not state that has to be set after sign-in. That
  // mutability is what allowed a verified session to exist with no org at all.
  //
  // NULLABLE, deliberately: a user row exists between sign-up and org creation,
  // and 21 such rows exist in production today. Tightening this to NOT NULL is
  // a separate decision that requires triaging them.
  //
  // `set null`, NOT the `cascade` that `member.organization_id` carried. On a
  // membership row cascade was right — delete the org, delete the membership.
  // On a person it would mean deleting an organization DELETES THE PEOPLE IN IT,
  // taking their appointment and shift history with them. The org going away
  // means they belong nowhere, not that they never existed.
  organizationId: text('organization_id').references(() => organization.id, {
    onDelete: 'set null',
  }),
  /**
   * The user's role WITHIN their organization — owner / admin / member.
   *
   * Deliberately NOT called `role`: `user.role` above is Better Auth's admin
   * plugin field and means PLATFORM admin. Both would use the value 'admin' for
   * entirely different powers, so a single `role` column would let an org admin
   * read as a platform admin. Keep them separate and differently named.
   */
  orgRole: text('org_role').$type<'owner' | 'admin' | 'member'>(),
  /** Terms/privacy acceptance, recorded at invite-accept time. From `member`. */
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),

  // ── Staff profile (absorbed from `practitioner`) ───────────────────────────
  /**
   * Whether this person DOES THE WORK — the bit that a `practitioner` row's
   * existence used to carry.
   *
   * Without it the merge silently promotes everyone: a receptionist, or an org
   * member who books nobody, inherits `is_active` and `accepts_bookings` from
   * their defaults and appears on the public booking page as bookable staff.
   *
   * Defaults FALSE. A plain user is not staff until something says so — a
   * default of true would re-create exactly the bug this exists to prevent.
   */
  isStaff: boolean('is_staff').notNull().default(false),

  // A staff member IS a user. There is no separate practitioner record to keep
  // in step — which is what `sync-practitioner-photo-for-user` existed to do.
  //
  // A user with no credentials (no `account` row) is staff who cannot sign in:
  // 22 such people exist in production, all of them bookable, so this is a
  // supported state and not a migration artefact.
  firstName: text('first_name'),
  lastName: text('last_name'),
  phone: text('phone'),
  phoneSecondary: text('phone_secondary'),
  phoneCountry: text('phone_country'),
  /** Country of residence/employment, distinct from `phoneCountry`. */
  country: countryEnum('country'),
  bio: text('bio'),
  /** e.g. "Senior Stylist". */
  title: text('title'),
  /** Public-profile headline (self-onboarding wizard), distinct from `title`. */
  headline: text('headline'),
  dateOfBirth: date('date_of_birth'),

  // Employment
  employmentStartDate: date('employment_start_date'),
  employmentEndDate: date('employment_end_date'),
  employmentType: employmentTypeEnum('employment_type'),
  /** External/payroll identifier. */
  teamMemberRef: text('team_member_ref'),
  notes: text('notes'),

  // Booking / public profile
  /**
   * Whether CUSTOMERS may book this person (the "Calendar bookings" toggle).
   * Read by the booking page, its practitioner picker, the write path and the
   * chatbot. Staff-side manual booking deliberately ignores it.
   */
  acceptsBookings: boolean('accepts_bookings').notNull().default(false),
  languages: text('languages').array(),
  socialLinks: jsonb('social_links').$type<UserSocialLinks>(),
  /** Calendar tint, unique per organization. */
  color: userColorEnum('color'),

  /**
   * Whether this person is currently working here. Distinct from `banned`
   * (Better Auth, platform-level) — an inactive staff member keeps their login.
   */
  isActive: boolean('is_active').notNull().default(true),
  profileSetupCompleted: boolean('profile_setup_completed')
    .notNull()
    .default(false),

  // Calendar / external booking integration
  calendarAccountId: text('calendar_account_id'),
  bookingAccountId: text('booking_account_id'),
  /** Calendly user URI, Timely staff ID, etc. */
  externalBookingId: text('external_booking_id'),
  /** Per-practitioner booking URL (Tier 2/3). */
  bookingLink: text('booking_link'),

  /** Soft delete — a former staff member whose appointment history must stay. */
  deletedAt: timestamp('deleted_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
