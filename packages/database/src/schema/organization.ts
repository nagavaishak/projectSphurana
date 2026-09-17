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
} from 'drizzle-orm/pg-core';
import {
  orgRlsPolicy,
  orgSelfRlsPolicy,
  organizationPublicBookingPolicy,
} from '../rls-policy.js';
import { user } from './user.js';

import type { ToneRegion } from '@borradh-workspace/labels';
import {
  chatbotGoalLabels,
  chatbotGoalValues,
  chatbotToneLabels,
  chatbotToneValues,
  toneRegionLabels,
  toneRegionValues,
} from '@borradh-workspace/labels';

// Import labels from enums (pure TypeScript)
import {
  bookingDestinationLabels,
  bookingDestinationValues,
  businessTypeLabels,
  businessTypeValues,
  contentStyleTemplateLabels,
  contentStyleTemplateValues,
  countryCodeLabels,
  countryCodeValues,
  depositAggregationValues,
  depositBasisValues,
  onboardingTaskLabels,
  onboardingTaskValues,
  outroStyleLabels,
  outroStyleValues,
  primaryCalendarTypeLabels,
  primaryCalendarTypeValues,
  servicePaymentPolicyValues,
  stylePreferenceLabels,
  stylePreferenceValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  onboardingTaskLabels,
  onboardingTaskValues,
  bookingDestinationLabels,
  bookingDestinationValues,
  primaryCalendarTypeLabels,
  primaryCalendarTypeValues,
  businessTypeLabels,
  businessTypeValues,
  countryCodeLabels,
  countryCodeValues,
  contentStyleTemplateLabels,
  contentStyleTemplateValues,
  stylePreferenceLabels,
  stylePreferenceValues,
  outroStyleLabels,
  outroStyleValues,
  toneRegionLabels,
  toneRegionValues,
  chatbotGoalLabels,
  chatbotGoalValues,
  chatbotToneLabels,
  chatbotToneValues,
};
export type {
  OnboardingTask,
  PrimaryCalendarType,
  BusinessType,
  CountryCode,
  ContentStyleTemplate,
  StylePreference,
  OutroStyle,
} from '@borradh-workspace/labels';
export type {
  ToneRegion,
  ChatbotGoal,
  ChatbotTone,
} from '@borradh-workspace/labels';

// =============================================================================
// CHATBOT SETTINGS (typed JSONB — org-level AI chatbot configuration)
// =============================================================================

export interface ChatbotDifferentiators {
  machine?: string;
  certs?: string;
  usps?: string[];
  reviews?: string;
  years?: number;
}

export interface ChatbotFaq {
  question: string;
  answer: string;
}

export interface ChatbotConsultation {
  type: 'free' | 'paid';
  duration?: number;
}

export interface ChatbotAvailability {
  evening?: boolean;
  nextSlot?: string;
}

export interface ChatbotSettings {
  // Existing fields
  goal?: string;
  tone?: string;

  // Borradh fields
  toneRegion?: ToneRegion;
  differentiators?: ChatbotDifferentiators;
  faqs?: ChatbotFaq[];
  consultation?: ChatbotConsultation;
  availability?: ChatbotAvailability;
  parkingInfo?: string;
  followUpEnabled?: boolean;

  // v3.1 owner/clinic fields
  ownerName?: string;
  ownerCredentials?: string;
  ownerAwards?: string;
  clinicPhone?: string;
  clinicEmail?: string;

  // v3.1 booking config.
  //
  // The deposit fields that used to live here (depositYesNo / depositAmount /
  // depositLink, and consultation.deposit above) were a THIRD and FOURTH copy of
  // the org's deposit settings, written by onboarding and read only by Claire's
  // prompt — so she quoted from one source while the booking charged from
  // another. Deposits now resolve through `resolveBookingPayment` alone.
  calendarConnected?: boolean;
  bookingSystem?: string;

  // v3.1 links
  galleryLink?: string;
  instagramLink?: string;
  reviewsLink?: string;
  specialOffers?: string;

  // v3.1 escalation
  escalationEmail?: string;
  escalationPhone?: string;

  // v3.1 treatment results data
  treatmentResults?: Record<string, string>;

  // Targeting restrictions (newLeadsOnly / adLeadsOnly) were removed — lead vs.
  // friends/family/returning-client/spam triage is now Claire's semantic
  // MESSAGE CLASSIFICATION, not a "have we seen this PSID / is it ad-referred"
  // gate.
}

// Database enums
export const bookingDestinationEnum = pgEnum(
  'booking_destination',
  bookingDestinationValues
);

export const primaryCalendarTypeEnum = pgEnum(
  'primary_calendar_type',
  primaryCalendarTypeValues
);
export const businessTypeEnum = pgEnum('business_type', businessTypeValues);
export const countryEnum = pgEnum('country', countryCodeValues);
export const contentStyleTemplateEnum = pgEnum(
  'content_style_template',
  contentStyleTemplateValues
);
export const outroStyleEnum = pgEnum('outro_style', outroStyleValues);
// Booking payment policy. Shared with `organization_service`, which declares the
// per-service override against these same three types.
export const servicePaymentPolicyEnum = pgEnum(
  'service_payment_policy',
  servicePaymentPolicyValues
);
export const depositBasisEnum = pgEnum('deposit_basis', depositBasisValues);
export const depositAggregationEnum = pgEnum(
  'deposit_aggregation',
  depositAggregationValues
);
export const stylePreferenceEnum = pgEnum(
  'style_preference',
  stylePreferenceValues
);

// Organization table
export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  businessType: businessTypeEnum('business_type').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
  metadata: text('metadata'),
  // API key for external integrations (ElevenLabs, etc.)
  apiKey: text('api_key').unique(),

  // Onboarding v2 fields - Website & Social
  websiteUrl: text('website_url'),
  facebookPageUrl: text('facebook_page_url'),
  // Privacy policy URL — used to prefill Meta lead forms
  privacyPolicyUrl: text('privacy_policy_url'),

  // Onboarding v2 fields - AI-extracted brand info
  brandVoice: jsonb('brand_voice').$type<string[]>().default([]),
  targetAudienceDescription: text('target_audience_description'),
  credibilityLine: text('credibility_line'),

  // Brand settings
  primaryColor: text('primary_color').default('#6366f1'),
  secondaryColor: text('secondary_color').default('#8b5cf6'),
  backgroundColor: text('background_color').default('#FFFFFF'),
  // A stored image showing the org's typography (a text-heavy past post, or a
  // specimen). Passed to the AI graphic model alongside the logo as a font
  // reference — image-gen models reproduce letterforms from a visual sample
  // far more reliably than from a font *name*. Auto-derived best-effort during
  // brand-corpus build; overridable. Pins typography across carousel slides.
  brandFontImageUrl: text('brand_font_image_url'),
  // A freeform brand STYLE GUIDE distilled once from the org's real posts +
  // colours + logo: the colour palette and how each colour is used
  // (backgrounds/headings/accents/text), the typography, and the overall
  // visual style/mood. Applied identically to every AI-generated graphic so
  // the whole output stays consistently on-brand (locked brand kit, richer
  // than a single hex). Auto-derived during brand-corpus build; editable.
  brandStyleGuide: text('brand_style_guide'),
  tagline: text('tagline'),
  address: text('address'),

  // NOTE: the public venue page's `about` prose and `amenities` live on
  // `organizationLocation`, NOT here — a venue IS a location (Fresha's model),
  // so each branch describes itself. A single-location org has exactly one
  // location, so this is invisible in the common case. See organization-location.ts.
  contentStyleTemplate: contentStyleTemplateEnum(
    'content_style_template'
  ).default('clean_minimal'),
  // Whether rendered graphics get the solid brand-color border ('basic') or
  // are left edge-to-edge ('clean'). Drives the border composite in both the
  // production graphic worker and the admin preview render.
  stylePreference: stylePreferenceEnum('style_preference').default('clean'),
  outroStyle: outroStyleEnum('outro_style').default('tagline'),

  // Business hours: { 0: { from: 540, to: 1080 }, ... } (day 0-6, time in minutes from midnight)
  businessHours: jsonb('business_hours')
    .$type<Record<number, { from: number; to: number }>>()
    .default({
      0: { from: 0, to: 0 },
      1: { from: 540, to: 1080 },
      2: { from: 540, to: 1080 },
      3: { from: 540, to: 1080 },
      4: { from: 540, to: 1080 },
      5: { from: 540, to: 1080 },
      6: { from: 0, to: 0 },
    })
    .notNull(),
  // IANA timezone the business operates in (e.g. "Europe/Dublin"). The single
  // source of truth for interpreting business_hours / shift wall-clock times
  // and for formatting offered slot times. NOT user.timezone — a business runs
  // in one timezone regardless of who is looking.
  timezone: text('timezone').notNull().default('UTC'),
  // Video defaults — new videos inherit these caption & music settings
  videoCaptionColor: text('video_caption_color').default('#FFFFFF'),
  videoCaptionFont: text('video_caption_font').default('Inter'),
  videoCaptionPosition: text('video_caption_position')
    .$type<'top' | 'center' | 'bottom'>()
    .default('bottom'),
  // Music volume on a 0-1 scale (matches the per-video default of 0.05)
  videoMusicVolume: real('video_music_volume').default(0.05),
  // Booking settings
  defaultBookingLink: text('default_booking_link'),
  // Deposit settings
  depositEnabled: boolean('deposit_enabled').default(false),
  depositAmount: integer('deposit_amount'), // in cents
  // What customers pay at booking, unless a service overrides it. The three
  // columns below are the org-level half of `resolveBookingPayment`.
  defaultPaymentPolicy: servicePaymentPolicyEnum('default_payment_policy')
    .notNull()
    .default('in_clinic'),
  defaultDepositBasis: depositBasisEnum('default_deposit_basis')
    .notNull()
    .default('fixed'),
  defaultDepositPercent: integer('default_deposit_percent'),
  // How several deposit-bearing services on ONE appointment combine.
  //
  // The COLUMN default is `sum` — today's behaviour — so backfilling the
  // existing rows takes no migration and no org's takings change under them.
  // New orgs are created with `largest` explicitly (see createOrganization),
  // which is the honest default: one appointment is one no-show risk, and
  // summing penalises the multi-service booking you most want.
  depositAggregation: depositAggregationEnum('deposit_aggregation')
    .notNull()
    .default('sum'),
  // How long a `held` slot survives before `expireAppointmentHolds` releases
  // it. One window for both flavours of hold — awaiting a deposit, and Claire
  // holding while the customer decides — because both are "hours to keep an
  // unpaid slot". Org-level policy, deliberately NOT on the Stripe integration
  // row where the deposit-only version of this setting used to live.
  holdExpirationHours: integer('hold_expiration_hours').default(24),
  // Rescheduling policy (Claire rescheduling flow)
  reschedulingNoticeRequiredHours: integer(
    'rescheduling_notice_required_hours'
  ).default(24),
  // Rescheduling policy (Portal v2 customer portal) — can customers reschedule
  // their own bookings online at all.
  customerReschedulingEnabled: boolean('customer_rescheduling_enabled')
    .notNull()
    .default(true),
  // Cancellation policy (Portal v2 customer portal) — can customers cancel
  // their own bookings online at all, and if so how much notice they must give.
  customerCancellationsEnabled: boolean('customer_cancellations_enabled')
    .notNull()
    .default(true),
  // 0–48 hours; 0 = no notice needed. Enforced server-side in
  // cancel-patient-booking.
  cancellationNoticeRequiredHours: integer('cancellation_notice_required_hours')
    .notNull()
    .default(0),
  noShowOrLateCancelFeeCents: integer('no_show_or_late_cancel_fee_cents'),
  // Onboarding task completion tracking
  completedOnboardingTasks: jsonb('completed_onboarding_tasks')
    .$type<string[]>()
    .default([])
    .notNull(),
  // Primary calendar settings for availability/booking. Defaults to OUR
  // calendar: /dashboard/calendar only renders the grid for 'borradh', so a NULL
  // here leaves the org with no calendar at all until it connects an external
  // one — which is never what a new business wants.
  primaryCalendarType: primaryCalendarTypeEnum('primary_calendar_type').default(
    'borradh'
  ),
  // ID of the connected calendar or booking account to use for availability
  primaryCalendarAccountId: text('primary_calendar_account_id'),
  // Where this organization takes bookings. Replaces primaryCalendarType (see
  // ENG-500) and gates the operational surface — calendar, booking page,
  // sales, inventory — none of which applies when the diary lives elsewhere.
  bookingDestination: bookingDestinationEnum('booking_destination')
    .notNull()
    .default('borradh'),
  // Default appointment duration in minutes
  defaultAppointmentDuration: integer('default_appointment_duration').default(
    30
  ),
  // Aggregate insights opt-in: whether this org's anonymised data contributes to cross-account benchmarks
  contributeToAggregateInsights: boolean('contribute_to_aggregate_insights')
    .notNull()
    .default(true),
  // Stripe customer ID (created during org setup, used for all billing)
  stripeCustomerId: text('stripe_customer_id'),

  // Whether the prices this clinic enters already include VAT. This is kept on
  // the clinic because it is a pricing policy, not a per-product decision.
  pricesIncludeVat: boolean('prices_include_vat').notNull().default(false),

  // AI Chatbot configuration (moved from chatbot table)
  chatbotSettings: jsonb('chatbot_settings').$type<ChatbotSettings>(),
  chatbotSystemPrompt: text('chatbot_system_prompt'),

  // Org-wide AI knowledge base (used by chatbot, assistant, etc.)
  knowledgeBase: jsonb('knowledge_base'),
  knowledgeBaseLastSyncedAt: timestamp('knowledge_base_last_synced_at'),

  // Voice cloning: AI-generated style profile from conversation embeddings
  voiceStyleProfile: text('voice_style_profile'),
  voiceStyleProfileUpdatedAt: timestamp('voice_style_profile_updated_at'),

  // Mock orgs used for brand-preview demos — never shown to real users
  isMock: boolean('is_mock').notNull().default(false),
});

// Member table
export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').default('member').notNull(),
    // Terms/privacy acceptance recorded at invite-accept time (self-onboarding)
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    index('idx_member_org_id').on(table.organizationId),
    index('idx_member_user_id').on(table.userId),
  ]
);

// Invitation table
export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    // Prefill fields for the invited-member Review-and-confirm step. Carry the
    // values the owner typed in the Profile panel so the accept flow can
    // pre-populate them. Country stored as plain text here (not the enum).
    firstName: text('first_name'),
    lastName: text('last_name'),
    phone: text('phone'),
    phoneCountry: text('phone_country'),
    country: text('country'),
    status: text('status').default('pending').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('idx_invitation_org_id').on(table.organizationId),
    index('idx_invitation_inviter_id').on(table.inviterId),
  ]
);

// RLS policies for membership tables.
// ⚠️  W-SYS FLAG: the membership-resolution path (resolving a user's active
// org before RLS context is established) MUST run via withSystemScope or
// pre-context — see docs/rls/CONVENTIONS.md §3. Do NOT wrap checkMemberAccess,
// checkAdminAccess, listOrganizations, getActiveOrganization,
// setActiveOrganization, acceptInvitation, or listPendingInvitations with
// withOrgScope; those operate before org context is known. See the W9 output
// for the full flagged list.
export const memberRlsPolicy = orgRlsPolicy(member);
export const invitationRlsPolicy = orgRlsPolicy(invitation);

// =============================================================================
// B3 — organization (keyed on id, not organization_id)
// =============================================================================

// org_self_isolation: standard authenticated + booking read/write for the org's
// own row (USING: id = current_setting('app.current_org_id', true)).
export const organizationRlsPolicy = orgSelfRlsPolicy(organization);

// slug_bootstrap: allows app_public to SELECT non-mock org rows WITHOUT org
// context being set. This is the ONLY policy in the schema that operates
// without org context. Used exclusively for the slug → org_id resolution step
// in the open booking flow BEFORE withPublicOrgScope sets the context.
// ⚠️  Security-critical — reviewed by W-GLOBAL. See rls-policy.ts for the full
// rationale. W-BOOK depends on this policy to bootstrap the booking session.
export const organizationPublicBookingRlsPolicy =
  organizationPublicBookingPolicy(organization);

// Note: organizationLocation relations are defined in organization-location.ts
// to avoid circular imports. The relation is: organization -> many(organizationLocation)

// Relations
export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
  // locations relation defined in organization-location.ts
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export type Organization = typeof organization.$inferSelect;
export type NewOrganization = typeof organization.$inferInsert;
export type Member = typeof member.$inferSelect;
export type NewMember = typeof member.$inferInsert;
export type Invitation = typeof invitation.$inferSelect;
export type NewInvitation = typeof invitation.$inferInsert;
