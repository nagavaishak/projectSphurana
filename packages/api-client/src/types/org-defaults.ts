/**
 * @borradh-workspace/api-client - Org Defaults API Types
 *
 * Per-org defaults for Claire (ad budget, ad objective, video orientation,
 * brand voice, etc.). Source of truth is the org-defaults service in
 * `@borradh-workspace/features/org-defaults`; this file re-exports the
 * resolved shape and adds the API-only `overrides` map.
 */

import type { OrgDefaults as BackendOrgDefaults } from '@borradh-workspace/features/org-defaults';

/**
 * Resolved org defaults — re-exported from the features package. No `Date`
 * fields, so no `Serialize<T>` needed.
 */
export type OrgDefaults = BackendOrgDefaults;

/**
 * Keys on `OrgDefaults` that may carry per-org overrides (everything except
 * `organizationId`). The `overrides` map on `OrgDefaultsResponse` is keyed
 * by these names.
 */
export type OrgDefaultsOverrideKey = Exclude<
  keyof OrgDefaults,
  'organizationId'
>;

/**
 * Response shape from `GET /org-defaults` and `PATCH /org-defaults`.
 *
 * Extends the resolved defaults with an `overrides` map: `true` means the
 * org has an explicit override set for that field, `false` means the value
 * is coming from the system fallback. The settings UI uses this to render
 * "system default" hints next to unset fields.
 */
export interface OrgDefaultsResponse extends OrgDefaults {
  overrides: Record<OrgDefaultsOverrideKey, boolean>;
}

/**
 * Patch body for `PATCH /org-defaults`.
 *
 * Every field is optional; `null` explicitly clears a previously-set
 * override (which then falls back to the system default at read time).
 * Omitted fields are untouched. `organizationId` comes from the session.
 *
 * `videoOrientation` is constrained to the same enum the backend schema
 * uses — keeping the literal here lets the frontend form's <select>
 * options stay in sync without a separate runtime dependency.
 */
export interface UpdateOrgDefaultsInput {
  adDailyBudgetCents?: number | null;
  adObjective?: string | null;
  videoOrientation?: 'landscape' | 'portrait' | 'square' | null;
  videoLengthSecs?: number | null;
  brandVoice?: string | null;
  defaultServiceIdForAds?: string | null;
}
