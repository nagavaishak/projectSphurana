import type { StylePreference } from '@borradh-workspace/api-client/types';

/**
 * The calendar/booking backends an org can be primary-linked to. Mirrors the
 * `primaryCalendarType` enum on the backend update-organization-settings schema.
 */
export type OrganizationPrimaryCalendarType =
  | 'borradh'
  | 'google_calendar'
  | 'calendly'
  | 'timely'
  | 'phorest'
  | 'fresha';

/**
 * The union of every organization field any settings surface can edit — all
 * optional. `PATCH organization/active` is reached from disjoint surfaces
 * (the details/style settings routes and the org-settings dialog's
 * details/branding/bookings/privacy tabs); each surface passes only the subset
 * it owns as this **intent**. The single {@link buildUpdateOrganizationPayload}
 * builder turns the intent into the strict wire body, so a field edited from
 * two places (e.g. `name` from both the details route and the details tab, or
 * the brand colours from both the style route and the branding tab) is
 * normalised identically and can never drift.
 *
 * This is NOT the wire body — it carries the raw form values (empty strings,
 * untrimmed text); the builder owns the per-field normalisation.
 */
export interface UpdateOrganizationIntent {
  name?: string;
  logo?: string | null;
  websiteUrl?: string | null;
  privacyPolicyUrl?: string | null;
  primaryColor?: string;
  secondaryColor?: string;
  brandStyleGuide?: string | null;
  stylePreference?: StylePreference;
  videoMusicVolume?: number;
  /** Field of record for where the org takes bookings (ENG-500). */
  bookingDestination?: 'borradh' | 'external_link';
  defaultBookingLink?: string | null;
  depositEnabled?: boolean;
  depositAmount?: number | null;
  defaultDepositBasis?: 'fixed' | 'percent';
  defaultDepositPercent?: number | null;
  reschedulingNoticeRequiredHours?: number | null;
  noShowOrLateCancelFeeCents?: number | null;
  /** Portal self-rescheduling policy (ENG-647). */
  customerReschedulingEnabled?: boolean;
  /** Portal self-cancellation policy (ENG-647). */
  customerCancellationsEnabled?: boolean;
  cancellationNoticeRequiredHours?: number;
  contributeToAggregateInsights?: boolean;
}
