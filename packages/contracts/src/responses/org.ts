/**
 * org response PROJECTIONS — hand-composed from generated atoms.
 *
 * Covers the ORG domain response surfaces: organization (the curated
 * active-org shape), organization locations, per-location opening hours,
 * per-org Claire defaults, practitioners (multi-staff booking), and phone
 * numbers. Atoms are 1:1 with a DB table; the projections here are the real
 * API contract: curated/redacted org views, list wrappers, computed schedule
 * shapes, and joined practitioner detail.
 *
 * Pure Zod, composed with `z.object` / `.extend` / `z.array` / `z.record`.
 * Dates are ISO strings (atoms already wire-shaped). Several jsonb columns are
 * `$type<>()`-typed in the DB but widen to `z.unknown()` in the atom — they are
 * hand-narrowed here to the DB `$type` so `z.infer` stays assignable to the
 * existing api-client derived types. See ./leads.ts and ./sales.ts for the
 * pattern.
 */
import {
  clinicAreaTypeValues,
  contentStyleTemplateValues,
  countryCodeValues,
  giftCardExpiryValues,
  onboardingTaskValues,
  resourceAssignmentModeValues,
  servicePriceTypeValues,
  venueAmenityValues,
} from '@borradh-workspace/labels';
import { depositBasisValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import {
  organizationLocationAtomSchema,
  organizationLocationOpeningHoursExceptionAtomSchema,
  organizationPhotoAtomSchema,
  phoneNumberAtomSchema,
  practitionerAtomSchema,
  practitionerLocationAtomSchema,
  practitionerServiceAtomSchema,
} from '../generated/index.js';
import { currencySchema } from './catalog.js';

// ============================================================================
// Shared building blocks
// ============================================================================

/**
 * A weekly opening-hours / working-hours map: day-of-week (0=Sun..6=Sat) →
 * `{ from, to }` minutes from midnight. The DB stores this as a
 * `Record<number, …>` jsonb column; on the wire the keys are JSON strings, and
 * a `Record<string, …>` is assignable to the `Record<number, …>` the api-client
 * types declare. Shared by organization-location, practitioner and
 * practitioner-location working hours, and the location schedule projection.
 */
export const openingHoursMapSchema = z.record(
  z.string(),
  z.object({ from: z.number(), to: z.number() })
);
export type OpeningHoursMap = z.infer<typeof openingHoursMapSchema>;

// ============================================================================
// ORGANIZATION — the curated "active org" response
// ============================================================================

/**
 * `GET /organization/active`, `POST /organization/active`, and the
 * organizations list — the CURATED organization shape the frontend consumes
 * (`api-client` `Organization`), NOT the full `organization` table atom.
 *
 * The endpoint spreads Better Auth's org object (id/name/slug/logo/createdAt/
 * metadata) and enriches it with a handful of calendar/deposit/chatbot fields
 * resolved from our DB. It is deliberately a small, redacted view — sensitive
 * columns (apiKey, brand corpus, …) never leave the server — so this is a
 * hand-modelled projection, not an atom pick.
 *
 * `.loose()` keeps any extra keys the wire carries (the spread can include more
 * Better-Auth fields than the curated contract lists) so report-mode parsing
 * never silently drops data; only the declared fields are validated.
 */
const organizationFieldsSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable(),
  createdAt: z.string(),
  timezone: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  primaryCalendarType: z.string().nullable().optional(),
  // Field of record for where the org takes bookings (ENG-500). Gates the
  // booking-system navigation surface.
  bookingDestination: z.string().nullable().optional(),
  primaryCalendarAccountId: z.string().nullable().optional(),
  defaultBookingLink: z.string().nullable().optional(),
  /** Org-wide fallback appointment length in minutes (ENG-793). */
  defaultAppointmentDuration: z.number().nullable().optional(),
  depositEnabled: z.boolean().optional(),
  depositAmount: z.number().nullable().optional(),
  defaultDepositBasis: z.enum(depositBasisValues).optional(),
  defaultDepositPercent: z.number().nullable().optional(),
  reschedulingNoticeRequiredHours: z.number().nullable().optional(),
  noShowOrLateCancelFeeCents: z.number().nullable().optional(),
  /** Portal self-rescheduling policy (ENG-647). */
  customerReschedulingEnabled: z.boolean().optional(),
  /** Portal self-cancellation policy (ENG-647). */
  customerCancellationsEnabled: z.boolean().optional(),
  cancellationNoticeRequiredHours: z.number().optional(),
  chatbotSystemPrompt: z.string().nullable().optional(),
  chatbotSettings: z.record(z.string(), z.unknown()).nullable().optional(),
});

/**
 * The org as the API returns it. `.loose()` at RUNTIME so a response carrying a
 * field this contract hasn't caught up with still parses instead of throwing —
 * but the TYPE comes from the strict base, because a catchall index signature
 * would make `OrganizationFields` assignable to (and from) almost anything.
 */
export const organizationSchema = organizationFieldsSchema.loose();
export type OrganizationResponse = z.infer<typeof organizationSchema>;

/**
 * The exact declared field set, with no passthrough index signature. This is
 * what `features`' `Organization` entity derives from, so adding a field here
 * reaches the backend entity, api-client and the frontend in one edit.
 */
export type OrganizationFields = z.infer<typeof organizationFieldsSchema>;

/** `GET /organizations` — the `{ organizations }` wrapper (a bare list, no total). */
export const listOrganizationsResponseSchema = z.object({
  organizations: z.array(organizationSchema),
});
export type ListOrganizationsResponse = z.infer<
  typeof listOrganizationsResponseSchema
>;

/**
 * An organization membership row (api-client `OrganizationMember`). There is no
 * generated `member` atom, so this small shape is hand-modelled to the contract.
 * The members-list endpoint returns a richer, user-joined shape (handled at that
 * call site); this is the plain membership projection.
 */
export const organizationMemberSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
  createdAt: z.string(),
});
export type OrganizationMemberResponse = z.infer<
  typeof organizationMemberSchema
>;

/**
 * `GET /organizations/:id/members` — the richer, user-joined members-list shape
 * the endpoint actually returns (a bare array). Unlike the plain membership
 * projection above it OMITS `organizationId` and adds the joined `user`; `role`
 * is a free string (the service does not narrow it to the membership enum).
 */
export const organizationMemberWithUserSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: z.string(),
  createdAt: z.string(),
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
  }),
});
export type OrganizationMemberWithUser = z.infer<
  typeof organizationMemberWithUserSchema
>;

/** `GET /organizations/:id/members` — bare array of user-joined members. */
export const listOrganizationMembersResponseSchema = z.array(
  organizationMemberWithUserSchema
);
export type ListOrganizationMembersResponse = z.infer<
  typeof listOrganizationMembersResponseSchema
>;

/**
 * `POST /organizations/:id/invitations` — the created invitation
 * (`InviteMemberResponse`). `role` is nullable (the invitation column is).
 */
export const invitationResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  email: z.string(),
  role: z.string().nullable(),
  status: z.string(),
  expiresAt: z.string(),
  inviterId: z.string(),
});
export type InvitationResponse = z.infer<typeof invitationResponseSchema>;

/**
 * `GET /organizations/invitations/pending` — bare array of the caller's pending
 * invites, each enriched with the org name + inviter name (joined server-side).
 */
export const pendingInvitationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  email: z.string(),
  role: z.string().nullable(),
  status: z.string(),
  expiresAt: z.string(),
  inviterName: z.string().nullable(),
});
export type PendingInvitation = z.infer<typeof pendingInvitationSchema>;

export const listPendingInvitationsResponseSchema = z.array(
  pendingInvitationSchema
);
export type ListPendingInvitationsResponse = z.infer<
  typeof listPendingInvitationsResponseSchema
>;

// ============================================================================
// ORGANIZATION LOCATIONS
// ============================================================================

/**
 * An organization location (a physical branch). The atom widens the
 * `opening_hours` jsonb (`$type<LocationOpeningHours>`) to `z.unknown()`; narrow
 * it back to the weekly map so `z.infer` matches api-client `OrganizationLocation`.
 */
export const organizationLocationSchema = organizationLocationAtomSchema.extend(
  {
    openingHours: openingHoursMapSchema.nullable(),
    // `amenities` is jsonb, so the generated atom types it as unknown; narrow it
    // back to the canonical amenity keys to match api-client's OrganizationLocation
    // (`VenueAmenity[]`). about/slug come through the atom as string|null.
    amenities: z.array(z.enum(venueAmenityValues)),
  }
);
export type OrganizationLocationResponse = z.infer<
  typeof organizationLocationSchema
>;

/** `GET /organization-locations` — `{ items }` (a bare list, no pagination meta). */
export const listLocationsResponseSchema = z.object({
  items: z.array(organizationLocationSchema),
});
export type ListLocationsResponse = z.infer<typeof listLocationsResponseSchema>;

// ============================================================================
// LOCATION OPENING HOURS — standing schedule + per-date exceptions
// ============================================================================

/**
 * A per-date opening-hours override (a closed day or bespoke hours). The atom is
 * 1:1 with the `org_location_opening_hours_exception` table and matches the
 * api-client `OpeningHoursException` verbatim.
 */
export const openingHoursExceptionSchema =
  organizationLocationOpeningHoursExceptionAtomSchema;
export type OpeningHoursExceptionResponse = z.infer<
  typeof openingHoursExceptionSchema
>;

/**
 * `GET /locations/:id/opening-hours` — the computed schedule projection (no
 * single backing table): the location's standing weekly hours, the org-level
 * fallback, and the per-date exceptions inside the queried window.
 */
export const locationScheduleResultSchema = z.object({
  locationId: z.string(),
  openingHours: openingHoursMapSchema.nullable(),
  organizationDefault: openingHoursMapSchema.nullable(),
  exceptions: z.array(openingHoursExceptionSchema),
});
export type LocationScheduleResultResponse = z.infer<
  typeof locationScheduleResultSchema
>;

// ============================================================================
// ORG DEFAULTS — resolved per-org Claire defaults + overrides map
// ============================================================================

/**
 * `GET /org-defaults` and `PATCH /org-defaults` — the RESOLVED defaults (every
 * Claire-relevant field filled from the org row or the system fallback) plus an
 * `overrides` map flagging which fields are user-set vs system-default.
 *
 * This is a computed shape, not the `org_defaults` atom (the atom's fields are
 * mostly nullable; here they are resolved to concrete values), so it is
 * hand-modelled to the api-client `OrgDefaultsResponse` contract.
 */
export const orgDefaultsResponseSchema = z.object({
  organizationId: z.string(),
  adDailyBudgetCents: z.number(),
  adObjective: z.string(),
  videoOrientation: z.string(),
  videoLengthSecs: z.number(),
  brandVoice: z.string().nullable(),
  defaultServiceIdForAds: z.string().nullable(),
  adAreaType: z.enum(clinicAreaTypeValues).nullable(),
  wageAutoClockIn: z.boolean(),
  wageAutoClockOut: z.boolean(),
  wageAutomatedBreaks: z.boolean(),
  giftCardPresetAmounts: z.array(z.number()),
  giftCardExpiry: z.enum(giftCardExpiryValues),
  resourceAssignmentMode: z.enum(resourceAssignmentModeValues),
  /** `true` = the org has an explicit override for that field; `false` = fallback. */
  overrides: z.record(z.string(), z.boolean()),
});
export type OrgDefaultsResponseShape = z.infer<
  typeof orgDefaultsResponseSchema
>;

// ============================================================================
// PRACTITIONERS
// ============================================================================

/**
 * A practitioner (bookable staff member). The atom widens the `working_hours`
 * and `social_links` jsonb (`$type<…>`) to `z.unknown()`; narrow them back to
 * match api-client `Practitioner`.
 */
export const practitionerSocialLinksSchema = z
  .object({
    instagram: z.string().optional(),
    tiktok: z.string().optional(),
    facebook: z.string().optional(),
  })
  .catchall(z.string().optional());

export const practitionerSchema = practitionerAtomSchema.extend({
  workingHours: openingHoursMapSchema.nullable(),
  socialLinks: practitionerSocialLinksSchema.nullable(),
});
export type PractitionerResponse = z.infer<typeof practitionerSchema>;

/** A practitioner↔service junction row (the atom, verbatim). */
export const practitionerServiceSchema = practitionerServiceAtomSchema;
export type PractitionerServiceResponse = z.infer<
  typeof practitionerServiceSchema
>;

/**
 * A practitioner↔location junction row. The atom widens per-location
 * `working_hours` to `z.unknown()`; narrow to the weekly map.
 */
export const practitionerLocationSchema = practitionerLocationAtomSchema.extend(
  {
    workingHours: openingHoursMapSchema.nullable(),
  }
);
export type PractitionerLocationResponse = z.infer<
  typeof practitionerLocationSchema
>;

/**
 * A practitioner with its optionally-loaded service and location junctions —
 * the `GET /practitioners/:id` and list-item detail shape. Both relations are
 * optional: not every code path loads them.
 */
export const practitionerWithRelationsSchema = practitionerSchema.extend({
  services: z.array(practitionerServiceSchema).optional(),
  locations: z.array(practitionerLocationSchema).optional(),
});
export type PractitionerWithRelationsResponse = z.infer<
  typeof practitionerWithRelationsSchema
>;

/**
 * `GET /practitioners/me` — the current user's practitioner, with its joined
 * services and calendar account NARROWED to what the /me view-model consumes.
 * The service selects only `services[].service.{id,name}` and
 * `calendarAccount.{id,email}` (the full rows — incl. calendar credentials —
 * are deliberately NOT egressed). `calendarAccount` is always present as a key
 * (null when the practitioner has no linked calendar).
 */
export const practitionerForUserServiceSchema = z.object({
  service: z.object({ id: z.string(), name: z.string() }),
});
export const practitionerForUserResponseSchema = practitionerSchema.extend({
  services: z.array(practitionerForUserServiceSchema),
  calendarAccount: z.object({ id: z.string(), email: z.string() }).nullable(),
});
export type PractitionerForUserResponse = z.infer<
  typeof practitionerForUserResponseSchema
>;

/** `GET /practitioners` — list projection: `{ items, limit, offset }` (no total). */
export const listPractitionersResponseSchema = z.object({
  items: z.array(practitionerWithRelationsSchema),
  limit: z.number(),
  offset: z.number(),
});
export type ListPractitionersResponseShape = z.infer<
  typeof listPractitionersResponseSchema
>;

/** `GET /practitioners/for-service/:id` — a bare array of practitioners+relations. */
export const practitionersForServiceResponseSchema = z.array(
  practitionerWithRelationsSchema
);
export type PractitionersForServiceResponse = z.infer<
  typeof practitionersForServiceResponseSchema
>;

// ============================================================================
// PHONE NUMBERS
// ============================================================================

/** A phone number owned by the org (the atom, verbatim). */
export const phoneNumberSchema = phoneNumberAtomSchema;
export type PhoneNumberResponse = z.infer<typeof phoneNumberSchema>;

/**
 * `GET /phone-numbers` — the list projection: the org's numbers plus the
 * plan-derived quota counters. `maxAllowed`/`currentCount` are computed, not
 * table columns.
 */
export const phoneNumberListResponseSchema = z.object({
  items: z.array(phoneNumberSchema),
  maxAllowed: z.number(),
  currentCount: z.number(),
});
export type PhoneNumberListResponseShape = z.infer<
  typeof phoneNumberListResponseSchema
>;

// ============================================================================
// ORG BRAND — resolved branding + content-style definition
// ============================================================================

/**
 * The fully-resolved content-style definition nested on the brand response
 * (`ContentStyleDefinition`). Not a table — resolved from the style template +
 * org overrides — so hand-modelled to the api-client shape.
 */
export const contentStyleDefinitionSchema = z.object({
  id: z.enum(contentStyleTemplateValues),
  name: z.string(),
  description: z.string(),
  defaultColors: z.object({
    primary: z.string(),
    secondary: z.string(),
    accent: z.string(),
    background: z.string(),
    text: z.string(),
  }),
  fonts: z.object({
    heading: z.string(),
    body: z.string(),
    accent: z.string(),
  }),
  captionStyle: z.object({
    fontFamily: z.string(),
    fontSize: z.number(),
    color: z.string(),
    backgroundColor: z.string(),
    showBackground: z.boolean(),
    backgroundStyle: z.enum(['none', 'solid', 'rounded', 'highlight']),
    borderRadius: z.number().optional(),
    padding: z.number().optional(),
  }),
  outroStyle: z.object({
    layout: z.enum(['centered', 'split', 'minimal', 'branded']),
    logoPosition: z.enum([
      'top',
      'bottom',
      'center',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ]),
    animationStyle: z.enum(['fade', 'slide', 'zoom', 'none']),
    durationInFrames: z.number(),
  }),
  graphicStyle: z.object({
    textAlignment: z.enum(['left', 'center', 'right']),
    overlayOpacity: z.number(),
    borderRadius: z.number(),
    shadowStyle: z.enum(['none', 'soft', 'strong']),
  }),
  previewUrl: z.string().optional(),
});
export type ContentStyleDefinition = z.infer<
  typeof contentStyleDefinitionSchema
>;

/**
 * `GET /organizations/:id/brand` — resolved brand config (`OrganizationBrandConfig`).
 * Colors are always concrete (fall back to the template default), `logoUrl` and
 * `tagline` are nullable. No table backs this exact shape.
 */
export const organizationBrandResponseSchema = z.object({
  organizationId: z.string(),
  primaryColor: z.string(),
  secondaryColor: z.string(),
  backgroundColor: z.string(),
  contentStyleTemplate: z.enum(contentStyleTemplateValues),
  resolvedStyle: contentStyleDefinitionSchema,
  logoUrl: z.string().nullable(),
  tagline: z.string().nullable(),
});
export type OrganizationBrandResponse = z.infer<
  typeof organizationBrandResponseSchema
>;

// ============================================================================
// VENUE — public venue page + dashboard photo management
// ============================================================================

/**
 * An organization gallery photo (the atom, verbatim). Backs the dashboard photo
 * CRUD/reorder/set-cover endpoints and the `photos` array of the venue config.
 */
export const organizationPhotoSchema = organizationPhotoAtomSchema;
export type OrganizationPhotoResponse = z.infer<typeof organizationPhotoSchema>;

/** `GET /venue/photos` and reorder/set-cover — `{ items }` (a bare list). */
export const listOrganizationPhotosResponseSchema = z.object({
  items: z.array(organizationPhotoSchema),
});
export type ListOrganizationPhotosResponse = z.infer<
  typeof listOrganizationPhotosResponseSchema
>;

/**
 * `PUT /venue/:locationId` — the updated venue details for one location
 * (about + amenities + slug). `amenities` is narrowed to the canonical amenity
 * enum.
 */
export const updateLocationVenueResponseSchema = z.object({
  locationId: z.string(),
  about: z.string().nullable(),
  amenities: z.array(z.enum(venueAmenityValues)),
  slug: z.string().nullable(),
});
export type UpdateLocationVenueResponse = z.infer<
  typeof updateLocationVenueResponseSchema
>;

/**
 * The curated brand shape on the venue page — the ORGANIZATION-level fields
 * shared across every venue (no sensitive columns). Venue-specific fields
 * (about/amenities/address/hours) live on `location` below.
 */
export const venueConfigOrganizationSchema = z.object({
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable(),
  timezone: z.string(),
  reschedulingNoticeRequiredHours: z.number().nullable(),
  noShowOrLateCancelFeeCents: z.number().nullable(),
});
export type VenueConfigOrganization = z.infer<
  typeof venueConfigOrganizationSchema
>;

/**
 * The venue itself — one physical location (branch) of the organization. A
 * venue IS a location, so its about/amenities/address/geo/opening-hours live
 * here, resolved from `organization_location`.
 */
export const venueConfigLocationSchema = z.object({
  id: z.string(),
  slug: z.string().nullable(),
  name: z.string().nullable(),
  about: z.string().nullable(),
  amenities: z.array(z.enum(venueAmenityValues)),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  city: z.string(),
  county: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.enum(countryCodeValues),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  openingHours: openingHoursMapSchema.nullable(),
});
export type VenueConfigLocation = z.infer<typeof venueConfigLocationSchema>;

/**
 * A customer-chosen pricing option on a service, as shown on the public venue
 * page / booking wizard — a SUBSET of the full `serviceVariantSchema` atom (only
 * the fields a customer picks between). Shared by the venue and booking configs.
 */
export const venueConfigServiceVariantSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceCents: z.number().nullable(),
  durationMinutes: z.number().nullable(),
});
export type VenueConfigServiceVariant = z.infer<
  typeof venueConfigServiceVariantSchema
>;

/** A bookable service as shown on the public venue page. */
export const venueConfigServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** The org's OWN category name, or null when the service has none. Never the
   *  legacy `category` enum — see `serviceCategoryName`. */
  category: z.string().nullable(),
  /** DEPRECATED freeform price — derive display from (priceType, priceCents,
   *  variants) via `formatServicePrice`. */
  priceText: z.string().nullable(),
  priceType: z.enum(servicePriceTypeValues),
  priceCents: z.number().nullable(),
  appointmentDuration: z.number().nullable(),
  variants: z.array(venueConfigServiceVariantSchema),
});
export type VenueConfigServiceResponse = z.infer<
  typeof venueConfigServiceSchema
>;

/** A team member (active practitioner) as shown on the public venue page. */
export const venueConfigTeamMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  photo: z.string().nullable(),
  title: z.string().nullable(),
  bio: z.string().nullable(),
});
export type VenueConfigTeamMember = z.infer<typeof venueConfigTeamMemberSchema>;

/**
 * `GET /public/venue/:organizationSlug(/:locationSlug)` — the full public venue
 * page view-model: curated brand (`organization`), the resolved venue
 * (`location`, incl. about/amenities/address/geo/opening-hours), ordered gallery
 * photos (the location's own, then org-wide shared photos), active services and
 * active team. Dates on `photos` are ISO strings on the wire (the atom is
 * already wire-shaped).
 */
export const venueConfigSchema = z.object({
  organization: venueConfigOrganizationSchema,
  location: venueConfigLocationSchema,
  /** The org's display currency, from the venue location's country. */
  currency: currencySchema,
  photos: z.array(organizationPhotoSchema),
  services: z.array(venueConfigServiceSchema),
  team: z.array(venueConfigTeamMemberSchema),
  /**
   * Does this org have a branch OTHER than the one on this page?
   *
   * A boolean, not a count: the page's only question is whether to offer "View
   * all locations", and shipping a number invites a renderer to print it
   * ("3 locations") — which would then be a second, staler source for
   * something the chooser already lists authoritatively.
   *
   * `false` on a single-branch clinic, where the control would link to a
   * chooser that immediately 302s back to this page — a link that looks like a
   * choice and is not one.
   */
  hasOtherLocations: z.boolean(),
});
export type VenueConfig = z.infer<typeof venueConfigSchema>;

// ============================================================================
// PUBLIC BOOKING — the branch chooser
// ============================================================================

/**
 * One branch on the public booking chooser
 * (`GET /public/booking/:organizationSlug/locations`).
 *
 * NOT `venueConfigLocationSchema`. That is the payload of a page a customer has
 * already navigated INTO one venue to read (about prose, amenities, gallery);
 * this is the card they read to decide which venue that will be. Sharing one
 * schema would mean the chooser either ships prose it never renders, or the
 * venue page loses fields — so the narrower shape is its own atom.
 */
export const bookingLocationSchema = z.object({
  id: z.string(),
  /** Nullable while `organization_location.slug` still is (backfill pending). */
  slug: z.string().nullable(),
  name: z.string().nullable(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  city: z.string(),
  county: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.enum(countryCodeValues),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  /** This branch's standing hours, else the org's business hours. */
  openingHours: openingHoursMapSchema.nullable(),
  /** Branch cover photo, else the branch's first, else an org-wide photo. */
  photo: z.string().nullable(),
  isPrimary: z.boolean(),
});
export type BookingLocation = z.infer<typeof bookingLocationSchema>;

/**
 * `GET /public/booking/:organizationSlug/locations` — every bookable branch of
 * one org, primary first. A single-branch org returns a one-element list; the
 * 302-past-the-chooser decision belongs to the route, not the payload.
 */
export const listBookingLocationsResponseSchema = z.object({
  organizationName: z.string(),
  organizationSlug: z.string(),
  organizationLogo: z.string().nullable(),
  locations: z.array(bookingLocationSchema),
});
export type ListBookingLocationsResponse = z.infer<
  typeof listBookingLocationsResponseSchema
>;

// ============================================================================
// ONBOARDING TASKS — computed checklist
// ============================================================================

/**
 * `GET /organization/onboarding-tasks` — the computed onboarding checklist.
 * `tasks` completion is derived from live data probes; `id` is the onboarding
 * task enum. No backing table.
 */
export const onboardingTaskStatusSchema = z.object({
  id: z.enum(onboardingTaskValues),
  title: z.string(),
  completed: z.boolean(),
});
export type OnboardingTaskStatus = z.infer<typeof onboardingTaskStatusSchema>;

export const getOnboardingTasksResponseSchema = z.object({
  tasks: z.array(onboardingTaskStatusSchema),
  completedCount: z.number(),
  totalCount: z.number(),
});
export type GetOnboardingTasksResponse = z.infer<
  typeof getOnboardingTasksResponseSchema
>;
