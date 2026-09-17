import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { lead } from './leads.js';
import { organization } from './organization.js';

import { orgRlsPolicy, patientSelfRlsPolicy } from '../rls-policy.js';

/**
 * Patient portal auth (ENG-647 / Portal v2) — backed by a SECOND, isolated
 * Better Auth instance (`@borradh-workspace/auth/patient`), NOT the bespoke
 * token/session store it replaces. These four tables are BA's canonical
 * models, mapped into the patient instance's drizzleAdapter:
 *
 *   customer_account   → BA `user`         (universal identity, email-keyed)
 *   patient_session    → BA `session`      (+ organization_id pin, see below)
 *   patient_ba_account → BA `account`      (empty under passwordless)
 *   patient_verification → BA `verification` (OTP codes + magic-link tokens)
 *
 * CRITICAL (drizzle-adapter): the JS PROPERTY keys must equal BA's field names
 * (id, userId, emailVerified, …) — the physical column names in `text('…')`
 * are free. Do not rename a property without updating the BA field mapping.
 *
 * RLS: all four have RLS ENABLED with ZERO policies — fail-closed for every
 * non-BYPASSRLS role. They are read/written only by the patient BA instance on
 * the system (BYPASSRLS) connection, exactly like the staff Better Auth tables.
 * They carry no `app_patient` grants (see RLS_GLOBAL_EXEMPT).
 */

/**
 * Universal customer identity (BA `user` model) — one email = one account,
 * silently linked across every clinic the person books with. Deliberately NOT
 * org-scoped: the per-org membership is `patient_auth`.
 */
export const customerAccount = pgTable('customer_account', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  /** BA `user.name` — required by the schema; passwordless sign-in leaves it ''. */
  name: text('name').notNull().default(''),
  /** Stored lowercase — normalisation enforced in the patient-auth services. */
  email: text('email').notNull().unique(),
  /** BA `user.emailVerified`. */
  emailVerified: boolean('email_verified').notNull().default(false),
  /** BA `user.image`. */
  image: text('image'),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
}).enableRLS();

/**
 * Patient portal membership (ENG-647 / Portal v2) — links a universal
 * `customer_account` to one clinic's `lead` row. The clinic's CUSTOMER, not
 * clinic staff. Hangs 1:1 off the `lead` row (the canonical person record).
 * `organization_id` is denormalized from the lead so `orgRlsPolicy` applies.
 *
 * This is the ONLY patient table that is org-scoped and app_patient-readable —
 * it is the domain join BA knows nothing about.
 */
export const patientAuth = pgTable(
  'patient_auth',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    leadId: text('lead_id')
      .notNull()
      .unique()
      .references(() => lead.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** The universal identity (BA user) this per-org membership belongs to. */
    customerAccountId: text('customer_account_id')
      .notNull()
      .references(() => customerAccount.id, { onDelete: 'cascade' }),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_patient_auth_org_id').on(table.organizationId),
    // ONE membership per person per clinic.
    //
    // `lead_id` being unique is not enough. Duplicate lead rows for the same
    // person are the normal state of a CRM — they book online, then phone,
    // then arrive as a walk-in — and each grew its own membership, after
    // which the resolver picked between them with an unordered findFirst. The
    // customer's bookings appeared and disappeared between page loads, and
    // two family members sharing an email at one clinic could be shown each
    // other's records.
    //
    // The (account, org) pair is the real identity;
    // `findOrCreatePatientAuthMembership` resolves on it first, and this
    // makes a second row impossible.
    unique('uq_patient_auth_account_org').on(
      table.customerAccountId,
      table.organizationId
    ),
  ]
);

export const patientAuthRlsPolicy = orgRlsPolicy(patientAuth);
/** A signed-in patient can read their own membership row (patient_self). */
export const patientAuthPatientSelfPolicy = patientSelfRlsPolicy(patientAuth);

/**
 * Patient portal sessions (BA `session` model). BA mints an opaque, SIGNED
 * session token, stored here and carried in an httpOnly cookie.
 *
 * `organization_id` is a BA session ADDITIONAL FIELD — the clinic the session
 * was minted for. The `PatientAuthGuard` rejects any request presenting the
 * session against a different `X-Portal-Org`. Without it, a staff-minted magic
 * link (which proves the clinic's say-so, NOT email ownership) for a universal
 * account could be replayed against ANOTHER clinic the same person attends.
 * (ENG-647 cross-org fix.) It is nullable at the column level (BA additional
 * field, `input:false`), stamped at session creation by the instance's
 * `session.create.before` hook; the guard enforces its presence.
 */
export const patientSession = pgTable(
  'patient_session',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    /** BA `session.token` — the signed session credential. */
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** BA `session.userId` → the customer_account (BA user). */
    userId: text('user_id')
      .notNull()
      .references(() => customerAccount.id, { onDelete: 'cascade' }),
    /** Additional field: the pinned clinic (see doc above). */
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_patient_session_user_id').on(table.userId),
    index('idx_patient_session_token').on(table.token),
  ]
).enableRLS();

/**
 * BA `account` model. Required by BA's core schema; effectively empty under a
 * passwordless (emailOTP + magicLink) instance, but the adapter expects it.
 */
export const patientBaAccount = pgTable('patient_ba_account', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => customerAccount.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
}).enableRLS();

/**
 * BA `verification` model — stores emailOTP codes and magic-link tokens
 * (hashed per the instance's storeOTP/storeToken config). Keyed by an opaque
 * identifier; never read by an org-scoped query.
 */
export const patientVerification = pgTable('patient_verification', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
}).enableRLS();

// Types
export type CustomerAccount = typeof customerAccount.$inferSelect;
export type NewCustomerAccount = typeof customerAccount.$inferInsert;
export type PatientAuth = typeof patientAuth.$inferSelect;
export type NewPatientAuth = typeof patientAuth.$inferInsert;
export type PatientSession = typeof patientSession.$inferSelect;
export type NewPatientSession = typeof patientSession.$inferInsert;
export type PatientBaAccount = typeof patientBaAccount.$inferSelect;
export type PatientVerification = typeof patientVerification.$inferSelect;
