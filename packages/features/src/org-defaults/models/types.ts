import type {
  ClinicAreaType,
  GiftCardExpiry,
  ResourceAssignmentMode,
} from '@borradh-workspace/labels';

/**
 * Resolved org defaults — every Claire-relevant field is filled in, either
 * from the org's `org_defaults` row or from the system-wide fallback.
 *
 * `brandVoice`, `defaultServiceIdForAds` and `adAreaType` are intentionally
 * nullable:
 * - `brandVoice` has no sensible system default; Claire infers it from the
 *   org profile when missing.
 * - `defaultServiceIdForAds` is optional — if unset, the ads skill picks a
 *   service via the recommend/list heuristic.
 * - `adAreaType` is null until Claire asks the owner (city vs countryside)
 *   during the first campaign; the targeting radius falls back to a neutral
 *   default until then.
 */
export interface OrgDefaults {
  organizationId: string;
  adDailyBudgetCents: number;
  adObjective: string;
  videoOrientation: string;
  videoLengthSecs: number;
  brandVoice: string | null;
  defaultServiceIdForAds: string | null;
  adAreaType: ClinicAreaType | null;

  // Wage / auto-clock workspace defaults (contract §1.1.8). Practitioner
  // wage-config values of 'workspace_default' resolve through these.
  wageAutoClockIn: boolean;
  wageAutoClockOut: boolean;
  wageAutomatedBreaks: boolean;

  // Gift card org settings (integer cents; expiry validated against
  // `giftCardExpiryValues`).
  giftCardPresetAmounts: number[];
  giftCardExpiry: GiftCardExpiry;

  // How appointments get their rooms/equipment. NOTE: online bookings are
  // always auto-assigned regardless of this setting — a client cannot pick a
  // room, and 'manual' there would leave online slots ungated.
  resourceAssignmentMode: ResourceAssignmentMode;
}
