/**
 * team / practitioners / locations request CONTRACTS — the canonical, strict
 * Zod schema for the BODY of each write endpoint in the "who works here, and
 * where" surface area.
 *
 * A request contract is the wire-shaped twin of a response projection: it
 * describes exactly what the client is allowed to POST/PUT, written here in
 * pure Zod so it stays frontend-safe (no drizzle / database in the runtime
 * graph — see index.ts).
 *
 * DIRECTION OF DERIVATION — wire -> server
 * ---------------------------------------
 * This file is the SOURCE. Every feature schema listed below DERIVES from it by
 * `.extend()`ing the server-injected context fields onto the exported Base:
 *
 *   packages/features/src/practitioners/services/
 *     create-practitioner/create-practitioner.schema.ts
 *     update-practitioner/update-practitioner.schema.ts
 *     create-team-member/create-team-member.schema.ts
 *     assign-practitioner-locations/assign-practitioner-locations.schema.ts
 *     assign-practitioner-services/assign-practitioner-services.schema.ts
 *   packages/features/src/organizations/services/
 *     invite-member/invite-member.schema.ts
 *     accept-invitation/accept-invitation.schema.ts
 *   packages/features/src/organization-locations/services/
 *     create-location/create-location.schema.ts
 *     update-location/update-location.schema.ts
 *
 * Because each server schema literally IS the wire schema plus fields, it can
 * never be laxer than the wire schema, and no drift is possible. Do NOT invert
 * this — a contract hand-copied from a feature schema is exactly the drift this
 * package exists to eliminate.
 *
 * BASE vs SCHEMA — why two exports
 * --------------------------------
 * `.refine()` returns a `ZodEffects`, which has NO `.extend()`. So every
 * contract exports a matched pair:
 *
 *  - `<name>RequestBase`   — a plain `z.object({…})`. EXTENDABLE. This is what
 *    the backend feature schema extends with its context fields. It is NOT
 *    strict, because `.strict()` would reject the very fields being added.
 *  - `<name>RequestSchema` — `<name>RequestBase.strict()`. This is what
 *    VALIDATES a wire body: unknown fields are REJECTED, so a client sending a
 *    stale, renamed, or typo'd key fails loudly instead of having it silently
 *    stripped by a permissive `z.object`.
 *
 * Context fields the SERVER injects are absent from every body contract here:
 *  - `organizationId` — from the active-org session.
 *  - `inviterId` / `userId` — from the authenticated user.
 *  - `id` / `practitionerId` / `invitationId` — route params.
 *
 * WHAT IS *NOT* HERE
 * ------------------
 * There is no `updateTeamMember` contract because there is no such endpoint:
 * editing an existing team member is `PUT practitioners/:id`
 * (`updatePractitionerRequestSchema`) plus the two assignment endpoints and
 * `PUT practitioners/:id/wage-config` (owned by the scheduling contract). The
 * composite `POST practitioners/team-member` exists only for CREATE.
 */
import {
  countryCodeValues,
  employmentTypeValues,
  teamPermissionLevelValues,
  userColorValues,
  wageAutomationSettingValues,
  wageCompensationTypeValues,
  wageOvertimeTypeValues,
  wageRegularHoursPerValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// jsonb payload shapes
// ---------------------------------------------------------------------------
//
// `practitioner.social_links` and `practitioner.working_hours` are jsonb columns
// whose TypeScript shape lives on the Drizzle table
// (`PractitionerSocialLinks` / `WorkingHours` in
// packages/database/src/schema/practitioners.ts). Contracts must not pull
// `@borradh-workspace/database` into their graph — not even type-only, because
// the emitted `.d.ts` would then force apps/app to resolve the database package
// — so the two shapes are restated here structurally. They are STRUCTURALLY
// IDENTICAL to the Drizzle types, so values flow between the two without a cast
// (TypeScript is structural), and the feature schemas that derive from this file
// still hand the service a value the table accepts.

/** Wire twin of the database `PractitionerSocialLinks` jsonb shape. */
export type PractitionerSocialLinksWire = {
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  [k: string]: string | undefined;
};

/**
 * Wire twin of the database `WorkingHours` jsonb shape: day-of-week
 * (0=Sunday..6=Saturday) → minutes-from-midnight range.
 */
export type PractitionerWorkingHoursWire = Record<
  number,
  { from: number; to: number }
>;

/** Minutes-from-midnight range, bounded to a single day. */
const workingHoursDaySchema = z.object({
  from: z.number().min(0).max(1440),
  to: z.number().min(0).max(1440),
});

/**
 * The runtime schema is a record keyed by the day number rendered as a string
 * (JSON object keys are always strings); the cast re-labels the inferred type as
 * the jsonb shape the column stores, exactly as the feature schemas did before
 * they derived from here.
 */
const optionalWorkingHours = z
  .record(z.string(), workingHoursDaySchema)
  .optional() as unknown as z.ZodOptional<
  z.ZodType<PractitionerWorkingHoursWire>
>;

const nullishWorkingHours = z
  .record(z.string(), workingHoursDaySchema)
  .nullish() as unknown as z.ZodOptional<
  z.ZodNullable<z.ZodType<PractitionerWorkingHoursWire>>
>;

const optionalSocialLinks = z
  .record(z.string(), z.string())
  .optional() as unknown as z.ZodOptional<
  z.ZodType<PractitionerSocialLinksWire>
>;

const nullishSocialLinks = z
  .record(z.string(), z.string())
  .nullish() as unknown as z.ZodOptional<
  z.ZodNullable<z.ZodType<PractitionerSocialLinksWire>>
>;

// ---------------------------------------------------------------------------
// POST /practitioners
// ---------------------------------------------------------------------------

/**
 * `POST /practitioners` body — the EXTENDABLE half.
 *
 * `name` is optional at the schema level: the service derives it from
 * first+last when absent, and REJECTS the case where neither `name` nor
 * first+last are given. That is a service-level invariant (it needs to phrase
 * one error for two ways of naming a person), not a body-shape one, so it stays
 * in the service rather than becoming a `.refine()` here.
 *
 * `email` is REQUIRED and `.email()`-validated: a practitioner is invited by
 * email, so there is no blank case to normalise. `bookingLink` is the one field
 * that explicitly tolerates `''` (a cleared input) alongside a URL.
 */
export const createPractitionerRequestBase = z.object({
  name: z.string().min(1).optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email('Invalid email'),
  phone: z.string().optional(),
  phoneSecondary: z.string().optional(),
  phoneCountry: z.string().optional(),
  country: z.enum(countryCodeValues).optional(),
  photo: z.string().url().optional(),
  bio: z.string().optional(),
  title: z.string().optional(),
  /** Public-profile headline (self-onboarding wizard, distinct from `title`). */
  headline: z.string().max(64).optional(),
  dateOfBirth: z.string().optional(),
  // Work details
  employmentStartDate: z.string().optional(),
  employmentEndDate: z.string().optional(),
  employmentType: z.enum(employmentTypeValues).optional(),
  teamMemberRef: z.string().optional(),
  notes: z.string().max(1000).optional(),
  // Booking / public profile
  acceptsBookings: z.boolean().optional(),
  languages: z.array(z.string()).optional(),
  socialLinks: optionalSocialLinks,
  bookingAccountId: z.string().optional(),
  externalBookingId: z.string().optional(),
  bookingLink: z.string().url().optional().or(z.literal('')),
  /** Optional override; the service auto-picks an unused colour if omitted. */
  color: z.enum(userColorValues).optional(),
  workingHours: optionalWorkingHours,
});

/** `POST /practitioners` body — the VALIDATING half. */
export const createPractitionerRequestSchema =
  createPractitionerRequestBase.strict();

export type CreatePractitionerRequest = z.infer<
  typeof createPractitionerRequestSchema
>;

// ---------------------------------------------------------------------------
// PUT /practitioners/:id
// ---------------------------------------------------------------------------

/**
 * `PUT /practitioners/:id` body — the EXTENDABLE half. PATCH semantics: only
 * the keys present are written.
 *
 * The `.nullish()` fields are the ones a surface can CLEAR: `null` means "unset
 * this", absent means "leave it". That distinction is why they are not simply
 * `.optional()`, and why the apps/app builder maps a blank input to `null`
 * rather than dropping the key.
 *
 * `email` and `name` carry format/`min(1)` constraints while being optional —
 * the pair that bites. A blank form input is `''`, which is neither absent nor
 * valid, so `buildUpdatePractitionerPayload` normalises `''` to *omitted*. Do
 * not relax these to accept `''`; that would let a practitioner's name be
 * silently blanked.
 */
export const updatePractitionerRequestBase = z.object({
  name: z.string().min(1).optional(),
  firstName: z.string().min(1).nullish(),
  lastName: z.string().min(1).nullish(),
  email: z.string().email().optional(),
  phone: z.string().nullish(),
  phoneSecondary: z.string().nullish(),
  phoneCountry: z.string().nullish(),
  country: z.enum(countryCodeValues).nullish(),
  photo: z.string().url().nullish(),
  bio: z.string().nullish(),
  title: z.string().nullish(),
  headline: z.string().max(64).nullish(),
  dateOfBirth: z.string().nullish(),
  employmentStartDate: z.string().nullish(),
  employmentEndDate: z.string().nullish(),
  employmentType: z.enum(employmentTypeValues).nullish(),
  teamMemberRef: z.string().nullish(),
  notes: z.string().max(1000).nullish(),
  acceptsBookings: z.boolean().optional(),
  languages: z.array(z.string()).nullish(),
  socialLinks: nullishSocialLinks,
  isActive: z.boolean().optional(),
  calendarAccountId: z.string().nullish(),
  color: z.enum(userColorValues).nullable().optional(),
  workingHours: nullishWorkingHours,
});

/** `PUT /practitioners/:id` body — the VALIDATING half. */
export const updatePractitionerRequestSchema =
  updatePractitionerRequestBase.strict();

export type UpdatePractitionerRequest = z.infer<
  typeof updatePractitionerRequestSchema
>;

// ---------------------------------------------------------------------------
// POST /practitioners/team-member  (composite "Add team member")
// ---------------------------------------------------------------------------

/**
 * Partial wage-config patch accepted by the composite team-member create.
 *
 * Mirrors `PUT practitioners/:id/wage-config` minus its context fields
 * (`organizationId`/`practitionerId`, supplied by the orchestration). All
 * fields optional — only provided keys are written (upsert semantics).
 */
export const teamMemberWageConfigRequestBase = z.object({
  compensationType: z.enum(wageCompensationTypeValues).optional(),
  hourlyRateCents: z.number().int().min(0).nullable().optional(),
  overtimeEnabled: z.boolean().optional(),
  regularWorkHours: z.number().positive().max(168).nullable().optional(),
  regularWorkHoursPer: z.enum(wageRegularHoursPerValues).optional(),
  overtimeType: z.enum(wageOvertimeTypeValues).nullable().optional(),
  overtimeMultiplier: z.number().positive().max(10).nullable().optional(),
  overtimeHourlyRateCents: z.number().int().min(0).nullable().optional(),
  autoClockIn: z.enum(wageAutomationSettingValues).optional(),
  autoClockOut: z.enum(wageAutomationSettingValues).optional(),
  automatedBreaks: z.enum(wageAutomationSettingValues).optional(),
  /** Proximity/location restriction (50m) — stored now, enforced later (P3). */
  locationRestriction: z.enum(wageAutomationSettingValues).optional(),
});

export const teamMemberWageConfigRequestSchema =
  teamMemberWageConfigRequestBase.strict();

export type TeamMemberWageConfigRequest = z.infer<
  typeof teamMemberWageConfigRequestSchema
>;

/**
 * `POST /practitioners/team-member` body — the EXTENDABLE half.
 *
 * The composite create: the practitioner profile, the association sets
 * (services/locations), a partial wage-config patch, and a `permissionLevel`
 * that maps to the invited member's org role.
 *
 * SECURITY: `permissionLevel` is the Low/Medium/High editor level, NOT a raw
 * `member.role`. `owner` is deliberately unreachable from this body —
 * `permissionLevelToRole` maps low→member and medium/high→admin, so no team
 * member can be granted destructive owner powers through this endpoint. Do not
 * widen this field to accept a role.
 *
 * `.default('low')` MATERIALISES into the parsed body: a caller that omits
 * `permissionLevel` sends `permissionLevel: 'low'` on the wire. That default
 * lives here rather than in the feature schema because the feature schema IS
 * this object plus context — moving it would change server behaviour, not just
 * client behaviour.
 */
export const createTeamMemberRequestBase = z.object({
  // --- Practitioner profile ---------------------------------------------
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  email: z.string().email('Invalid email'),
  phone: z.string().optional(),
  phoneSecondary: z.string().optional(),
  phoneCountry: z.string().optional(),
  country: z.enum(countryCodeValues).optional(),
  dateOfBirth: z.string().optional(),
  employmentStartDate: z.string().optional(),
  employmentEndDate: z.string().optional(),
  employmentType: z.enum(employmentTypeValues).optional(),
  teamMemberRef: z.string().optional(),
  notes: z.string().max(1000).optional(),
  acceptsBookings: z.boolean().optional(),
  /** The editor labels this "Job title"; it maps to the practitioner `title`. */
  jobTitle: z.string().optional(),
  headline: z.string().max(64).optional(),
  languages: z.array(z.string()).optional(),
  socialLinks: optionalSocialLinks,
  photo: z.string().url().optional(),
  /** Optional override; create-practitioner auto-picks an unused colour. */
  color: z.enum(userColorValues).optional(),

  // --- Permission → org role --------------------------------------------
  // low → member, medium/high → admin (via `permissionLevelToRole`).
  permissionLevel: z.enum(teamPermissionLevelValues).default('low'),

  // --- Associations ------------------------------------------------------
  serviceIds: z.array(z.string().min(1)).optional(),
  locationIds: z.array(z.string().min(1)).optional(),

  // --- Compensation ------------------------------------------------------
  // The STRICT half is nested deliberately: nothing extends the wage-config
  // patch (the orchestration supplies its context fields itself), so an unknown
  // key inside `wageConfig` is drift and must be rejected, not stripped.
  wageConfig: teamMemberWageConfigRequestSchema.optional(),
});

/** `POST /practitioners/team-member` body — the VALIDATING half. */
export const createTeamMemberRequestSchema =
  createTeamMemberRequestBase.strict();

export type CreateTeamMemberRequest = z.infer<
  typeof createTeamMemberRequestSchema
>;

// ---------------------------------------------------------------------------
// PUT /practitioners/:id/locations
// ---------------------------------------------------------------------------

/** One location assignment, with an optional per-location hours override. */
export const practitionerLocationAssignmentRequestBase = z.object({
  locationId: z.string().min(1),
  workingHours: nullishWorkingHours,
});

export const practitionerLocationAssignmentRequestSchema =
  practitionerLocationAssignmentRequestBase.strict();

export type PractitionerLocationAssignmentRequest = z.infer<
  typeof practitionerLocationAssignmentRequestSchema
>;

/**
 * `PUT /practitioners/:id/locations` body — the EXTENDABLE half.
 *
 * `.min(0)` is deliberate and load-bearing: an EMPTY array is a valid body,
 * meaning "this practitioner works at no location". The endpoint is a full
 * REPLACE, not an append, so unassigning the last location must be expressible.
 */
export const assignPractitionerLocationsRequestBase = z.object({
  // The STRICT half is nested deliberately: nothing extends an individual
  // assignment entry, so an unknown key inside one is drift and must be
  // rejected rather than silently stripped.
  locations: z.array(practitionerLocationAssignmentRequestSchema).min(0),
});

/** `PUT /practitioners/:id/locations` body — the VALIDATING half. */
export const assignPractitionerLocationsRequestSchema =
  assignPractitionerLocationsRequestBase.strict();

export type AssignPractitionerLocationsRequest = z.infer<
  typeof assignPractitionerLocationsRequestSchema
>;

// ---------------------------------------------------------------------------
// PUT /practitioners/:id/services
// ---------------------------------------------------------------------------

/**
 * `PUT /practitioners/:id/services` body — the EXTENDABLE half. As with
 * locations this is a full REPLACE, so `.min(0)` (an empty array clears every
 * service assignment) is intentional.
 */
export const assignPractitionerServicesRequestBase = z.object({
  serviceIds: z.array(z.string().min(1)).min(0),
});

/** `PUT /practitioners/:id/services` body — the VALIDATING half. */
export const assignPractitionerServicesRequestSchema =
  assignPractitionerServicesRequestBase.strict();

export type AssignPractitionerServicesRequest = z.infer<
  typeof assignPractitionerServicesRequestSchema
>;

// ---------------------------------------------------------------------------
// POST /organizations/invitations  (invite member)
// ---------------------------------------------------------------------------

/**
 * `role` values assignable by an invitation.
 *
 * NOT sourced from `@borradh-workspace/labels`: there is no `*Values` array for
 * `member.role` there — only `permissionLevelToRole`, whose codomain is exactly
 * this pair. This literal is lifted VERBATIM from the feature schema (it was
 * hand-written there too, and is not database-derived), so no new description of
 * the enum has been created; it has simply moved to the canonical file. Adding
 * `memberRoleValues` to labels and pointing both at it would be a strict
 * improvement, but is out of scope here.
 *
 * SECURITY: `owner` is absent by design — an invitation can never confer
 * ownership of the organization.
 */
const invitableRoleValues = ['member', 'admin'] as const;

/**
 * invite-member body — the EXTENDABLE half.
 *
 * `email` is REQUIRED and `.email()`-validated. The prefill fields are carried
 * onto the invitation so the invited member's Review-and-confirm step can
 * pre-populate; each is `.trim().min(1)` and optional, so a blank form input
 * must be OMITTED, never sent as `''`.
 *
 * `.default('member')` on `role` MATERIALISES into the parsed body: an omitted
 * role is sent as the LEAST privileged value, which is the safe direction.
 */
export const inviteMemberRequestBase = z.object({
  email: z.string().email('Invalid email format'),
  role: z.enum(invitableRoleValues).default('member'),
  // Prefill fields carried onto the invitation so the invited-member
  // Review-and-confirm step can pre-populate. All optional.
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(1).optional(),
  phoneCountry: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1).optional(),
});

/** invite-member body — the VALIDATING half. */
export const inviteMemberRequestSchema = inviteMemberRequestBase.strict();

export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;

// ---------------------------------------------------------------------------
// POST /practitioners/:id/invite
// ---------------------------------------------------------------------------

/**
 * invite-practitioner body — the EXTENDABLE half.
 *
 * Sends (or re-sends) the invitation for a team member who already exists as a
 * practitioner row. Everything identifying WHO is invited comes from that row —
 * the route param names the practitioner and the server reads their email off
 * it — so the body carries no email and cannot be used to point an invitation
 * at an arbitrary address.
 *
 * `permissionLevel` is optional rather than `.default('low')` on purpose: a
 * re-send must be able to leave an existing pending invitation's role exactly
 * as it stands, and a materialised default would silently demote it. When
 * omitted on a FIRST send the service falls back to `low` → `member`, the least
 * privileged value, which is the safe direction.
 */
export const invitePractitionerRequestBase = z.object({
  permissionLevel: z.enum(teamPermissionLevelValues).optional(),
});

/** invite-practitioner body — the VALIDATING half. */
export const invitePractitionerRequestSchema =
  invitePractitionerRequestBase.strict();

export type InvitePractitionerRequest = z.infer<
  typeof invitePractitionerRequestSchema
>;

// ---------------------------------------------------------------------------
// POST /organizations/invitations/:id/accept
// ---------------------------------------------------------------------------

/**
 * accept-invitation body — the EXTENDABLE half.
 *
 * The invitation id is the route param and the accepting user comes from the
 * session, so NEITHER is part of the body — the invitation token is never
 * re-stated by the client here and cannot be swapped for another. The body
 * carries only whether the Terms/Privacy agreement was accepted on the
 * Review-and-confirm step (`member.termsAcceptedAt` is stamped when true).
 */
export const acceptInvitationRequestBase = z.object({
  acceptedTerms: z.boolean().optional(),
});

/** accept-invitation body — the VALIDATING half. */
export const acceptInvitationRequestSchema =
  acceptInvitationRequestBase.strict();

export type AcceptInvitationRequest = z.infer<
  typeof acceptInvitationRequestSchema
>;

// ---------------------------------------------------------------------------
// POST /organization-locations
// ---------------------------------------------------------------------------

/**
 * The optional catalogue seed carried by `POST /organization-locations`.
 *
 * ADDITIVE ONLY, and that is a hard constraint of the data model rather than a
 * simplification. Zero join rows means "available at EVERY branch" — see
 * `atLocationOrUnassigned` — so anything not explicitly restricted today is
 * ALREADY available at a location the moment it is created. Every id listed
 * here therefore turns into an INSERT of `(entity, thisLocation)` and nothing
 * else: no other branch's rows are read, written or deleted.
 *
 * The consequence worth stating out loud: this cannot express "available
 * everywhere EXCEPT here". Doing that would mean materialising rows for every
 * other branch, which silently converts an unrestricted entity into an
 * explicitly-listed one and quietly excludes it from every branch created
 * afterwards. That is a deliberate non-feature.
 *
 * Every field is `.optional()` with NO `.default()`, so omitting the block
 * leaves the key absent rather than materialising empty arrays. "Copy nothing"
 * is the default and costs zero writes.
 */
export const locationCatalogSeedRequestSchema = z
  .object({
    /**
     * Replicate this branch's EXPLICIT assignments onto the new one. Entities
     * that branch inherits implicitly (no rows at all) are not copied, because
     * there is nothing to copy — the new branch already has them.
     */
    copyFromLocationId: z.string().min(1).optional().nullable(),
    practitionerIds: z.array(z.string().min(1)).optional(),
    serviceIds: z.array(z.string().min(1)).optional(),
    productIds: z.array(z.string().min(1)).optional(),
    membershipPlanIds: z.array(z.string().min(1)).optional(),
    offerIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type LocationCatalogSeedRequest = z.infer<
  typeof locationCatalogSeedRequestSchema
>;

/**
 * `POST /organization-locations` body — the EXTENDABLE half.
 *
 * `name` / `addressLine2` / `county` / `postalCode` / lat / lng are
 * `.optional().nullable()`: a location may legitimately have no name and no
 * postcode, and `null` is how a surface clears one.
 *
 * `.default(false)` on `isPrimary` MATERIALISES into the parsed body, so a
 * caller that omits it sends `isPrimary: false` — the safe direction (creating a
 * location never silently steals primary status).
 */
export const createLocationRequestBase = z.object({
  name: z.string().max(100, 'Name too long').optional().nullable(),
  addressLine1: z.string().min(1, 'Address is required').max(200),
  addressLine2: z.string().max(200).optional().nullable(),
  city: z.string().min(1, 'City is required').max(100),
  county: z.string().max(100).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  country: z.enum(countryCodeValues, { message: 'Invalid country code' }),
  isPrimary: z.boolean().optional().default(false),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  catalog: locationCatalogSeedRequestSchema.optional(),
});

/** `POST /organization-locations` body — the VALIDATING half. */
export const createLocationRequestSchema = createLocationRequestBase.strict();

export type CreateLocationRequest = z.infer<typeof createLocationRequestSchema>;

// ---------------------------------------------------------------------------
// PUT /organization-locations/:id
// ---------------------------------------------------------------------------

/**
 * `PUT /organization-locations/:id` body — the EXTENDABLE half. PATCH
 * semantics: every field optional, only the provided keys are written.
 *
 * Note `addressLine1` / `city` keep their `.min(1)` even though they are
 * optional here: you may leave them alone, but you may not blank them.
 * `isPrimary` has NO `.default()` on update (unlike create) — omitting it must
 * mean "leave primary as it is", not "demote".
 */
export const updateLocationRequestBase = z.object({
  name: z.string().max(100, 'Name too long').optional().nullable(),
  addressLine1: z.string().min(1).max(200).optional(),
  addressLine2: z.string().max(200).optional().nullable(),
  city: z.string().min(1).max(100).optional(),
  county: z.string().max(100).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  country: z
    .enum(countryCodeValues, { message: 'Invalid country code' })
    .optional(),
  isPrimary: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
});

/** `PUT /organization-locations/:id` body — the VALIDATING half. */
export const updateLocationRequestSchema = updateLocationRequestBase.strict();

export type UpdateLocationRequest = z.infer<typeof updateLocationRequestSchema>;
