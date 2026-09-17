/**
 * organization request CONTRACTS — the canonical, strict Zod schema for the
 * BODY of each organization-settings write endpoint.
 *
 * DIRECTION OF DERIVATION — wire -> server
 * ---------------------------------------
 * This file is the SOURCE. The feature schemas under
 * `packages/features/src/organizations/services/` DERIVE from it by
 * `.extend()`ing the server-injected context onto the base:
 *
 *     updateOrganizationSettingsSchema =
 *       updateOrganizationSettingsRequestBase.extend({ organizationId })
 *
 * Because the server schema literally IS the wire schema plus fields, it can
 * never be laxer than the wire schema, and no drift is possible. Do NOT invert
 * this.
 *
 * BASE vs SCHEMA — why two exports
 * --------------------------------
 *  - `<name>RequestBase`   — a plain `z.object({…})`. EXTENDABLE, NOT strict
 *    (`.strict()` would reject the very context fields being added).
 *  - `<name>RequestSchema` — `<name>RequestBase.strict()`. VALIDATES a wire
 *    body; unknown keys are rejected rather than silently stripped.
 *
 * Context fields the SERVER injects, absent from every body here:
 *  - `organizationId` — from the active-org session (`PATCH organization/active`
 *    literally means "the org I am currently in"), or from the route param on
 *    `PUT organizations/:id/chatbot-settings`. Never sent by the client.
 */
import {
  bookingDestinationValues,
  contentStyleTemplateValues,
  stylePreferenceValues,
} from '@borradh-workspace/labels';
import { depositBasisValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import { externalRedirectUrl } from './redirect-url.js';

/** Hex colour, 3- or 6-digit, `#`-prefixed. */
const hexColorPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

/**
 * One day's opening window, as MINUTES FROM MIDNIGHT (not a clock string).
 * `1440` is the inclusive upper bound so "closes at midnight" is expressible.
 */
const businessHoursEntrySchema = z.object({
  from: z.number().int().min(0).max(1440),
  to: z.number().int().min(0).max(1440),
});

/**
 * The weekly opening pattern, keyed by day-of-week index as a STRING
 * (`'0'` = Sunday … `'6'` = Saturday) because that is what JSON gives you —
 * object keys are always strings on the wire.
 *
 * The `.transform()` converts those to NUMBER keys for the service, which is
 * how `updateOrganizationSettings` consumes them. It is kept here rather than
 * pushed server-side deliberately: the contract must describe the wire shape
 * (string keys) AND produce the shape the derived server schema promises
 * (number keys). Re-serialising a parsed value to JSON turns the numeric keys
 * back into the same strings, so the round-trip is stable.
 */
const businessHoursSchema = z
  .record(z.string().regex(/^[0-6]$/), businessHoursEntrySchema)
  .transform((obj) => {
    const result: Record<number, { from: number; to: number }> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[Number(key)] = value;
    }
    return result;
  });

/**
 * `PATCH organization/active` body — the EXTENDABLE half. This is the whole
 * org-settings surface: branding, video defaults, booking + deposit policy.
 *
 * EVERY field is optional, because this is a PATCH — each settings screen sends
 * only the keys it owns. That makes `.strict()` (on the schema half) do real
 * work: a misspelled key on a partial update would otherwise be silently
 * dropped and the user would watch their change fail to persist with no error.
 *
 * ABSENT vs `null` is load-bearing throughout. Absent means "leave alone";
 * `null` means "clear it". Hence the `.optional().nullable()` pairs on the
 * link/URL/limit fields — `defaultBookingLink: null` unsets the booking link,
 * while omitting it keeps whatever is stored.
 *
 * Because the URL fields are `.url()`-validated, a settings input whose blank
 * value is `''` must be normalised — to `null` for "cleared", or to `undefined`
 * for "unchanged" — BEFORE the body is parsed. That normalisation lives in
 * `buildUpdateOrganizationPayload` in apps/app (`emptyToNull` / `normalizeLogo`);
 * sending `''` is a 400 from the server and now a parse error on the client too.
 *
 * `primaryCalendarType` is NOT settable over the wire, by design: the booking
 * settings UI writes `bookingDestination` (ENG-500) and the service derives the
 * legacy column from it until that column is dropped. Do not add it back.
 */
export const updateOrganizationSettingsRequestBase = z.object({
  // ── Core identity ──
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name too long')
    .optional(),
  logo: z.string().url('Invalid logo URL').optional().nullable(),
  websiteUrl: z.string().url('Invalid website URL').optional().nullable(),
  privacyPolicyUrl: z
    .string()
    .url('Invalid privacy policy URL')
    .optional()
    .nullable(),

  // ── Brand ──
  primaryColor: z
    .string()
    .regex(hexColorPattern, 'Invalid hex color')
    .optional(),
  secondaryColor: z
    .string()
    .regex(hexColorPattern, 'Invalid hex color')
    .optional(),
  backgroundColor: z
    .string()
    .regex(hexColorPattern, 'Invalid hex color')
    .optional()
    .nullable(),
  tagline: z.string().max(200, 'Tagline too long').optional().nullable(),
  /**
   * Freeform brand style guide — the AUTHORITY for colours, typography and the
   * overall look of generated graphics. It overrides the primary-colour picker
   * during generation, which is why it is editable: a rebrand has to actually
   * take effect.
   */
  brandStyleGuide: z
    .string()
    .max(8000, 'Brand style guide too long')
    .optional()
    .nullable(),
  contentStyleTemplate: z.enum(contentStyleTemplateValues).optional(),
  /** `clean` → edge-to-edge graphics, `basic` → solid brand-color border. */
  stylePreference: z.enum(stylePreferenceValues).optional(),

  // ── Video defaults (new videos inherit these) ──
  videoCaptionColor: z
    .string()
    .regex(hexColorPattern, 'Invalid hex color')
    .optional()
    .nullable(),
  videoCaptionFont: z
    .string()
    .max(100, 'Font name too long')
    .optional()
    .nullable(),
  videoCaptionPosition: z
    .enum(['top', 'center', 'bottom'])
    .optional()
    .nullable(),
  videoMusicVolume: z.number().min(0).max(1).optional().nullable(),

  // ── Availability & booking ──
  businessHours: businessHoursSchema.optional().nullable(),
  /** Used when `bookingDestination` is not `borradh`. */
  defaultBookingLink: z
    .string()
    .url('Invalid booking URL')
    .optional()
    .nullable(),
  /** Per-clinic deposit taken in the booking flow. */
  depositEnabled: z.boolean().optional(),
  /** Minor units (cents). Integer — never a float amount. */
  depositAmount: z.number().int().min(0).optional().nullable(),
  /**
   * How the org's default deposit is worked out. `percent` takes a share of the
   * service price (rounded up to the next 50c); `fixed` uses `depositAmount`.
   */
  defaultDepositBasis: z.enum(depositBasisValues).optional(),
  /** Whole percent, 1–100. Only meaningful when the basis is `percent`. */
  defaultDepositPercent: z
    .number()
    .int()
    .min(1, 'Must be at least 1%')
    .max(100, 'Cannot exceed 100%')
    .optional()
    .nullable(),
  /** Rescheduling policy used by the Claire rescheduling flow. */
  reschedulingNoticeRequiredHours: z
    .number()
    .int()
    .min(0)
    .optional()
    .nullable(),
  noShowOrLateCancelFeeCents: z.number().int().min(0).optional().nullable(),
  /** Whether patients may reschedule their own bookings from the portal (ENG-647). */
  customerReschedulingEnabled: z.boolean().optional(),
  /** Whether patients may cancel their own bookings from the portal (ENG-647). */
  customerCancellationsEnabled: z.boolean().optional(),
  /**
   * Hours of notice the portal requires before a patient self-cancel. NOT
   * nullable — the column is NOT NULL DEFAULT 0, and 0 already means "no
   * notice needed".
   */
  cancellationNoticeRequiredHours: z.number().int().min(0).max(48).optional(),
  primaryCalendarAccountId: z.string().optional().nullable(),
  /**
   * Where the organization takes bookings (ENG-500). NOT nullable: the column
   * is NOT NULL — every org books somewhere.
   */
  bookingDestination: z
    .enum(bookingDestinationValues)
    .optional()
    .describe('Where the organization takes bookings (ENG-500)'),

  // ── Misc ──
  credibilityLine: z
    .string()
    .max(500, 'Credibility line too long')
    .optional()
    .nullable(),
  /** Aggregate-insights opt-in. */
  contributeToAggregateInsights: z.boolean().optional(),
});

/** `PATCH organization/active` body — the VALIDATING half. */
export const updateOrganizationSettingsRequestSchema =
  updateOrganizationSettingsRequestBase.strict();

export type UpdateOrganizationSettingsRequest = z.infer<
  typeof updateOrganizationSettingsRequestSchema
>;

// ── Chatbot settings (the clinic's "business profile" for Claire) ──────────

/** What sets this clinic apart — free text, surfaced verbatim in replies. */
const chatbotDifferentiatorsSchema = z.object({
  usp: z.string().optional(),
  experience: z.string().optional(),
  approach: z.string().optional(),
});

/** One canned Q&A pair. Both halves are required — a question with no answer
 * is worse than no FAQ at all, since the bot would answer it from thin air. */
const chatbotFaqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

/** Consultation offer the bot can quote. Money here is MAJOR units (a price the
 * bot says out loud), unlike `depositAmount` on org settings which is cents. */
const chatbotConsultationSchema = z.object({
  durationMinutes: z.number().int().positive().optional(),
  price: z.number().nonnegative().optional(),
  deposit: z.number().nonnegative().optional(),
});

const chatbotAvailabilitySchema = z.object({
  evening: z.boolean().optional(),
  nextSlot: z.string().optional(),
});

/**
 * The clinic's business profile as the chatbot sees it. Every field is optional
 * — it is filled in incrementally by onboarding and by the settings screen, and
 * a partial profile still produces a usable bot.
 *
 * `clinicEmail` / `escalationEmail` are `.email()` and the link fields are
 * `.url()`, so blank inputs must be normalised to `undefined` before parsing
 * rather than sent as `''`.
 */
const chatbotSettingsSchema = z.object({
  goal: z.string().optional(),
  tone: z.string().optional(),
  toneRegion: z.string().optional(),
  differentiators: chatbotDifferentiatorsSchema.optional(),
  faqs: z.array(chatbotFaqSchema).optional(),
  consultation: chatbotConsultationSchema.optional(),
  availability: chatbotAvailabilitySchema.optional(),
  parkingInfo: z.string().optional(),
  followUpEnabled: z.boolean().optional(),
  ownerName: z.string().optional(),
  ownerCredentials: z.string().optional(),
  ownerAwards: z.string().optional(),
  clinicPhone: z.string().optional(),
  clinicEmail: z.string().email().optional(),
  calendarConnected: z.boolean().optional(),
  depositYesNo: z.boolean().optional(),
  depositAmount: z.number().nonnegative().optional(),
  bookingSystem: z.string().optional(),
  galleryLink: z.string().url().optional(),
  instagramLink: z.string().url().optional(),
  reviewsLink: z.string().url().optional(),
  specialOffers: z.string().optional(),
  escalationEmail: z.string().email().optional(),
  escalationPhone: z.string().optional(),
  treatmentResults: z.record(z.string(), z.string()).optional(),
});

/**
 * `PUT organizations/:id/chatbot-settings` body — the EXTENDABLE half.
 *
 * `knowledgeBase` is intentionally `z.unknown()`: it is an opaque blob the
 * ingestion pipeline owns, and pinning a shape here would mean this contract
 * has to change every time that pipeline learns a new document type. It is the
 * one place in this file where "unknown" is the honest description.
 */
export const updateChatbotSettingsRequestBase = z.object({
  chatbotSettings: chatbotSettingsSchema.optional(),
  chatbotSystemPrompt: z.string().optional().nullable(),
  knowledgeBase: z.unknown().optional().nullable(),
});

/** `PUT organizations/:id/chatbot-settings` body — the VALIDATING half. */
export const updateChatbotSettingsRequestSchema =
  updateChatbotSettingsRequestBase.strict();

export type UpdateChatbotSettingsRequest = z.infer<
  typeof updateChatbotSettingsRequestSchema
>;

// ── Instagram chatbot toggle ──────────────────────────────────────────────

/**
 * `PUT integrations/instagram/chatbot` body — the EXTENDABLE half.
 *
 * A single explicit boolean, never a toggle-without-a-value: three separate
 * surfaces flip this (the three-way toggle in chatbot page-toggles, the
 * per-channel switch in the Facebook settings dialog, and the enable-only
 * onboarding prompt), and an implicit "invert whatever is stored" would race
 * between them.
 */
export const toggleInstagramChatbotRequestBase = z.object({
  enabled: z.boolean(),
});

/** `PUT integrations/instagram/chatbot` body — the VALIDATING half. */
export const toggleInstagramChatbotRequestSchema =
  toggleInstagramChatbotRequestBase.strict();

export type ToggleInstagramChatbotRequest = z.infer<
  typeof toggleInstagramChatbotRequestSchema
>;

// ── User profile ──────────────────────────────────────────────────────────

/**
 * `PUT users/:id` body — the EXTENDABLE half.
 *
 * The signed-in user editing their OWN account (the controller 403s when the
 * `:id` route param is not the session user), so there is no org context here
 * at all — this is the one contract in this file the active organization does
 * not touch.
 *
 * A PATCH: every field optional, absent means "leave unchanged". `name` carries
 * the `.min(2)` both edit surfaces already enforce in their form, so the wire
 * rule and the form rule are literally the same rule. `image` is `.url()` AND
 * nullable — `null` removes the avatar, `''` is neither a URL nor a removal and
 * must be normalised before the body is built.
 *
 * `organizationId` is NOT part of this contract. The frontend builder used to
 * emit it and no surface ever set it; `updateUser` / `updateUserProfile` have
 * no such field, so it was parsed straight back off server-side. Changing which
 * organization is active is `PATCH organization/active`, a different endpoint
 * with different authorization — it was never going to work from here.
 *
 * `currency` and `timezone` are per-USER display preferences (distinct from the
 * ORG currency, which is derived from the org's country and is not settable).
 * No surface edits them yet; they are on the contract because the service
 * writes them.
 *
 * Context fields the SERVER injects, absent here:
 *  - `id` — the `:id` route param.
 */
export const updateUserRequestBase = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  email: z.string().email('Invalid email format').optional(),
  /** `null` removes the avatar. */
  image: z.string().url('Invalid image URL').nullable().optional(),
  currency: z.string().min(1, 'Currency is required').optional(),
  timezone: z.string().min(1, 'Timezone is required').optional(),
});

/** `PUT users/:id` body — the VALIDATING half. */
export const updateUserRequestSchema = updateUserRequestBase.strict();

export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

// ── Stripe Connect ────────────────────────────────────────────────────────

/**
 * `POST integrations/stripe/account-link` body — the EXTENDABLE half.
 *
 * Starts (or resumes) Stripe-hosted Connect onboarding. Both URLs are where
 * STRIPE sends the user back to, so both are `.url()`-validated ABSOLUTE URLs —
 * a relative path here produces a link Stripe accepts and a redirect that lands
 * nowhere, which is precisely the failure this validation exists to catch.
 *
 * The two differ only in WHEN Stripe uses them: `returnUrl` once onboarding is
 * submitted, `refreshUrl` if the (short-lived, single-use) link has expired or
 * is revisited. Both surfaces that start onboarding — the payments settings
 * panel and the sales notification banner — pass the same absolute base URL and
 * let the one builder append the `?stripe=return` / `?stripe=refresh` markers,
 * so the two can never disagree on how the URLs are shaped.
 *
 * Context fields the SERVER injects, absent here:
 *  - `organizationId`      — from the active-org session.
 *  - `userId` / `userEmail` — from the authenticated user, prefilled into the
 *    Stripe onboarding form.
 */
export const createAccountLinkRequestBase = z.object({
  /** Where Stripe returns the user once onboarding is submitted. */
  returnUrl: externalRedirectUrl,
  /** Where Stripe sends the user if the link expires or is revisited. */
  refreshUrl: externalRedirectUrl,
});

/** `POST integrations/stripe/account-link` body — the VALIDATING half. */
export const createAccountLinkRequestSchema =
  createAccountLinkRequestBase.strict();

export type CreateAccountLinkRequest = z.infer<
  typeof createAccountLinkRequestSchema
>;

/**
 * `POST integrations/stripe/link-account` body.
 *
 * Attaches an EXISTING Stripe connected account — one the merchant onboarded
 * from a link sent before their workspace existed — to the active org. The id
 * is the only thing the client sends; `organizationId` and `userId` are
 * injected server-side, which is why the base stays extendable.
 */
export const linkStripeAccountRequestBase = z.object({
  /** Stripe connected account id, e.g. `acct_1A2b3C4d5E6f7G8h`. */
  stripeAccountId: z
    .string()
    .trim()
    .regex(
      /^acct_[A-Za-z0-9]+$/,
      'Enter a Stripe account ID — it starts with "acct_".'
    ),
});

/** `POST integrations/stripe/link-account` body — the VALIDATING half. */
export const linkStripeAccountRequestSchema =
  linkStripeAccountRequestBase.strict();

export type LinkStripeAccountRequest = z.infer<
  typeof linkStripeAccountRequestSchema
>;

/**
 * `POST billing/subscription/seed` body.
 *
 * Attaches a subscription that already exists in Stripe — bought on a sales
 * call rather than through checkout — to the active organization. Same shape
 * as the admin-terminal route; the org comes from the session either way.
 */
export const seedSubscriptionRequestBase = z.object({
  /** Stripe subscription id (`sub_…`) or customer id (`cus_…`). */
  stripeRef: z
    .string()
    .trim()
    .regex(
      /^(sub|cus)_[A-Za-z0-9]+$/,
      'Enter a Stripe subscription ID (sub_…) or customer ID (cus_…).'
    ),
});

/** `POST billing/subscription/seed` body — the VALIDATING half. */
export const seedSubscriptionRequestSchema =
  seedSubscriptionRequestBase.strict();

export type SeedSubscriptionRequest = z.infer<
  typeof seedSubscriptionRequestSchema
>;
