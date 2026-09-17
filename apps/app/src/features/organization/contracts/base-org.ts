/**
 * Schema-validated base fixtures for the ORG domain contract tests.
 *
 * Each base is built through `defineFixture(schema, …)` so it is validated by
 * the SAME contracts schema the runtime parses responses with — if a DB column
 * changes and an atom regenerates, an out-of-date base fails to construct here.
 */
import {
  type GetOnboardingTasksResponse,
  type InvitationResponse,
  type LocationScheduleResultResponse,
  type OrgDefaultsResponseShape,
  type OrganizationBrandResponse,
  type OrganizationLocationResponse,
  type OrganizationMemberWithUser,
  type OrganizationResponse,
  type PendingInvitation,
  type PractitionerForUserResponse,
  type PractitionerWithRelationsResponse,
  defineFixture,
  getOnboardingTasksResponseSchema,
  invitationResponseSchema,
  locationScheduleResultSchema,
  orgDefaultsResponseSchema,
  organizationBrandResponseSchema,
  organizationLocationSchema,
  organizationMemberWithUserSchema,
  organizationSchema,
  pendingInvitationSchema,
  practitionerForUserResponseSchema,
  practitionerWithRelationsSchema,
} from '@borradh-workspace/contracts';

/** A valid curated `organization/active` response, on the wire. */
export const anOrganization: (
  overrides?: Partial<OrganizationResponse>
) => OrganizationResponse = defineFixture(organizationSchema, {
  id: 'org_1',
  name: 'Bloom Aesthetics',
  slug: 'bloom-aesthetics',
  logo: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  timezone: 'Europe/Dublin',
  metadata: null,
  primaryCalendarType: null,
  primaryCalendarAccountId: null,
  defaultBookingLink: null,
  depositEnabled: false,
  depositAmount: null,
  reschedulingNoticeRequiredHours: 24,
  noShowOrLateCancelFeeCents: null,
  customerReschedulingEnabled: true,
  customerCancellationsEnabled: true,
  cancellationNoticeRequiredHours: 0,
  chatbotSystemPrompt: null,
  chatbotSettings: null,
});

/** A valid organization location atom, on the wire. */
export const aLocation: (
  overrides?: Partial<OrganizationLocationResponse>
) => OrganizationLocationResponse = defineFixture(organizationLocationSchema, {
  id: 'loc_1',
  organizationId: 'org_1',
  name: 'Main Clinic',
  addressLine1: '1 Grafton Street',
  addressLine2: null,
  city: 'Dublin',
  county: null,
  postalCode: null,
  country: 'ie',
  latitude: null,
  longitude: null,
  // Venue fields (a venue IS a location).
  slug: null,
  about: null,
  amenities: [],
  openingHours: { '1': { from: 540, to: 1080 } },
  stripeTerminalLocationId: null,
  isPrimary: true,
  sortOrder: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
});

/** A valid practitioner (with optional relations) atom, on the wire. */
export const aPractitioner: (
  overrides?: Partial<PractitionerWithRelationsResponse>
) => PractitionerWithRelationsResponse = defineFixture(
  practitionerWithRelationsSchema,
  {
    id: 'prac_1',
    organizationId: 'org_1',
    userId: null,
    name: 'Ada Lovelace',
    firstName: null,
    lastName: null,
    email: 'ada@example.com',
    phone: null,
    phoneSecondary: null,
    phoneCountry: null,
    country: null,
    dateOfBirth: null,
    employmentStartDate: null,
    employmentEndDate: null,
    employmentType: null,
    teamMemberRef: null,
    notes: null,
    acceptsBookings: true,
    headline: null,
    languages: null,
    socialLinks: null,
    photo: null,
    bio: null,
    title: 'Senior Therapist',
    isActive: true,
    invitationPending: false,
    profileSetupCompleted: true,
    calendarAccountId: null,
    bookingAccountId: null,
    externalBookingId: null,
    bookingLink: null,
    workingHours: { '1': { from: 540, to: 1080 } },
    color: 'blue',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    deletedAt: null,
  }
);

/** A valid resolved org-defaults response (with the overrides map). */
export const orgDefaults: (
  overrides?: Partial<OrgDefaultsResponseShape>
) => OrgDefaultsResponseShape = defineFixture(orgDefaultsResponseSchema, {
  organizationId: 'org_1',
  adDailyBudgetCents: 2000,
  adObjective: 'leads',
  videoOrientation: 'portrait',
  videoLengthSecs: 30,
  brandVoice: null,
  defaultServiceIdForAds: null,
  adAreaType: 'city',
  wageAutoClockIn: false,
  wageAutoClockOut: false,
  wageAutomatedBreaks: false,
  giftCardPresetAmounts: [2500, 5000, 10000],
  giftCardExpiry: '1y',
  resourceAssignmentMode: 'auto',
  overrides: {
    adDailyBudgetCents: true,
    adObjective: false,
  },
});

/** A valid computed location schedule projection. */
export const aSchedule: (
  overrides?: Partial<LocationScheduleResultResponse>
) => LocationScheduleResultResponse = defineFixture(
  locationScheduleResultSchema,
  {
    locationId: 'loc_1',
    openingHours: { '1': { from: 540, to: 1080 } },
    organizationDefault: null,
    exceptions: [],
  }
);

/** The current user's practitioner (`GET /practitioners/me`) — narrowed joins. */
export const aPractitionerForUser: (
  overrides?: Partial<PractitionerForUserResponse>
) => PractitionerForUserResponse = defineFixture(
  practitionerForUserResponseSchema,
  {
    id: 'prac_1',
    organizationId: 'org_1',
    userId: 'user_1',
    name: 'Ada Lovelace',
    firstName: null,
    lastName: null,
    email: 'ada@example.com',
    phone: null,
    phoneSecondary: null,
    phoneCountry: null,
    country: null,
    dateOfBirth: null,
    employmentStartDate: null,
    employmentEndDate: null,
    employmentType: null,
    teamMemberRef: null,
    notes: null,
    acceptsBookings: true,
    headline: null,
    languages: null,
    socialLinks: null,
    photo: null,
    bio: null,
    title: 'Senior Therapist',
    isActive: true,
    invitationPending: false,
    profileSetupCompleted: false,
    calendarAccountId: null,
    bookingAccountId: null,
    externalBookingId: null,
    bookingLink: null,
    workingHours: { '1': { from: 540, to: 1080 } },
    color: 'blue',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    deletedAt: null,
    services: [{ service: { id: 'svc_1', name: 'Facial' } }],
    calendarAccount: null,
  }
);

/** A user-joined org member (`GET /organizations/:id/members`). */
export const aMember: (
  overrides?: Partial<OrganizationMemberWithUser>
) => OrganizationMemberWithUser = defineFixture(
  organizationMemberWithUserSchema,
  {
    id: 'member_1',
    userId: 'user_1',
    role: 'owner',
    createdAt: '2024-01-01T00:00:00.000Z',
    user: {
      id: 'user_1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      image: null,
    },
  }
);

/** A created invitation (`POST /organizations/:id/invitations`). */
export const anInvitation: (
  overrides?: Partial<InvitationResponse>
) => InvitationResponse = defineFixture(invitationResponseSchema, {
  id: 'invite_1',
  organizationId: 'org_1',
  email: 'grace@example.com',
  role: 'member',
  status: 'pending',
  expiresAt: '2024-02-01T00:00:00.000Z',
  inviterId: 'user_1',
});

/** A pending invitation for the caller (`GET /organizations/invitations/pending`). */
export const aPendingInvitation: (
  overrides?: Partial<PendingInvitation>
) => PendingInvitation = defineFixture(pendingInvitationSchema, {
  id: 'invite_1',
  organizationId: 'org_1',
  organizationName: 'Bloom Aesthetics',
  email: 'grace@example.com',
  role: 'member',
  status: 'pending',
  expiresAt: '2024-02-01T00:00:00.000Z',
  inviterName: 'Ada Lovelace',
});

/** Resolved brand config (`GET /organizations/:id/brand`). */
export const aBrand: (
  overrides?: Partial<OrganizationBrandResponse>
) => OrganizationBrandResponse = defineFixture(
  organizationBrandResponseSchema,
  {
    organizationId: 'org_1',
    primaryColor: '#111111',
    secondaryColor: '#222222',
    backgroundColor: '#FFFFFF',
    contentStyleTemplate: 'clean_minimal',
    resolvedStyle: {
      id: 'clean_minimal',
      name: 'Clean & Minimal',
      description: 'A clean, minimal style.',
      defaultColors: {
        primary: '#111111',
        secondary: '#222222',
        accent: '#333333',
        background: '#FFFFFF',
        text: '#000000',
      },
      fonts: { heading: 'Inter', body: 'Inter', accent: 'Inter' },
      captionStyle: {
        fontFamily: 'Inter',
        fontSize: 42,
        color: '#FFFFFF',
        backgroundColor: '#000000',
        showBackground: true,
        backgroundStyle: 'rounded',
      },
      outroStyle: {
        layout: 'centered',
        logoPosition: 'center',
        animationStyle: 'fade',
        durationInFrames: 60,
      },
      graphicStyle: {
        textAlignment: 'center',
        overlayOpacity: 0.4,
        borderRadius: 12,
        shadowStyle: 'soft',
      },
    },
    logoUrl: null,
    tagline: null,
  }
);

/** The computed onboarding checklist (`GET /organization/onboarding-tasks`). */
export const onboardingTasks: (
  overrides?: Partial<GetOnboardingTasksResponse>
) => GetOnboardingTasksResponse = defineFixture(
  getOnboardingTasksResponseSchema,
  {
    tasks: [
      {
        id: 'create-first-post',
        title: 'Create your first post',
        completed: true,
      },
      {
        id: 'link-booking-system',
        title: 'Link your booking system',
        completed: false,
      },
    ],
    completedCount: 1,
    totalCount: 2,
  }
);
