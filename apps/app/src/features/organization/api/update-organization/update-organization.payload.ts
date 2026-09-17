import { updateOrganizationSettingsRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';

import type { UpdateOrganizationIntent } from './update-organization.input';

/**
 * The wire body for `PATCH organization/active`, built in exactly one place.
 *
 * The schema is the CANONICAL request contract
 * (`packages/contracts/src/requests/organizations.ts`), which the backend
 * `updateOrganizationSettingsSchema` also derives from — so this surface can no
 * longer describe a narrower or differently-validated body than the server
 * enforces. It previously listed a hand-picked SUBSET of the settable fields;
 * the contract carries the full set (branding, video defaults, business hours,
 * booking + deposit policy). The builder below still emits only the keys the
 * caller's intent actually contains, so a PATCH stays a PATCH.
 *
 * Every field is optional (a PATCH sends only what changed) and `.strict()`
 * so an extra or misspelled key is a parse error rather than a silent strip.
 * All settings surfaces feed the shared {@link buildUpdateOrganizationPayload}
 * builder their {@link UpdateOrganizationIntent}; only this builder assembles
 * the request, so overlapping fields are guaranteed byte-identical.
 */
export const updateOrganizationBodySchema =
  updateOrganizationSettingsRequestSchema;

export type UpdateOrganizationBody = z.infer<
  typeof updateOrganizationBodySchema
>;

/** A cleared URL/link field persists as `null` (not an empty string). */
const emptyToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? (value ?? null) : null;
};

/**
 * The logo mirrors the "leave unchanged" convention: an empty picker value is
 * dropped (`undefined`) rather than sent as `''`, which the API would reject
 * against its `.url()` rule.
 */
const normalizeLogo = (
  value: string | null | undefined
): string | null | undefined =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/**
 * Turns an org-settings {@link UpdateOrganizationIntent} into the strict PATCH
 * body. Only keys actually present on the intent are emitted (so each surface
 * patches exactly the fields it owns), and each is normalised the same way
 * regardless of which surface supplied it.
 */
export function buildUpdateOrganizationPayload(
  intent: UpdateOrganizationIntent
): UpdateOrganizationBody {
  const body: Record<string, unknown> = {};

  if ('name' in intent) body.name = intent.name;
  if ('logo' in intent) body.logo = normalizeLogo(intent.logo);
  if ('websiteUrl' in intent) body.websiteUrl = emptyToNull(intent.websiteUrl);
  if ('privacyPolicyUrl' in intent)
    body.privacyPolicyUrl = emptyToNull(intent.privacyPolicyUrl);
  if ('primaryColor' in intent) body.primaryColor = intent.primaryColor;
  if ('secondaryColor' in intent) body.secondaryColor = intent.secondaryColor;
  if ('brandStyleGuide' in intent)
    body.brandStyleGuide = emptyToNull(intent.brandStyleGuide);
  if ('stylePreference' in intent)
    body.stylePreference = intent.stylePreference;
  if ('videoMusicVolume' in intent)
    body.videoMusicVolume = intent.videoMusicVolume;
  if ('defaultBookingLink' in intent)
    body.defaultBookingLink = emptyToNull(intent.defaultBookingLink);
  if ('bookingDestination' in intent)
    body.bookingDestination = intent.bookingDestination;
  if ('depositEnabled' in intent) body.depositEnabled = intent.depositEnabled;
  if ('depositAmount' in intent) body.depositAmount = intent.depositAmount;
  if ('defaultDepositBasis' in intent)
    body.defaultDepositBasis = intent.defaultDepositBasis;
  if ('defaultDepositPercent' in intent)
    body.defaultDepositPercent = intent.defaultDepositPercent;
  if ('reschedulingNoticeRequiredHours' in intent)
    body.reschedulingNoticeRequiredHours =
      intent.reschedulingNoticeRequiredHours;
  if ('noShowOrLateCancelFeeCents' in intent)
    body.noShowOrLateCancelFeeCents = intent.noShowOrLateCancelFeeCents;
  if ('customerReschedulingEnabled' in intent)
    body.customerReschedulingEnabled = intent.customerReschedulingEnabled;
  if ('customerCancellationsEnabled' in intent)
    body.customerCancellationsEnabled = intent.customerCancellationsEnabled;
  if ('cancellationNoticeRequiredHours' in intent)
    body.cancellationNoticeRequiredHours =
      intent.cancellationNoticeRequiredHours;
  if ('contributeToAggregateInsights' in intent)
    body.contributeToAggregateInsights = intent.contributeToAggregateInsights;

  return updateOrganizationBodySchema.parse(body);
}
