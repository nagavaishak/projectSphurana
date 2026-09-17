/**
 * @borradh-workspace/api-client - Offers API Types
 *
 * Types derived from the new offer shape (Window 1 + Window 9 rework).
 *
 * Old `OfferType` / `offerTypeLabels` exports are gone — the column was
 * renamed to `discountType` with cleaner enum values. State replaces the
 * `isActive` boolean. Coupon code, redemption limits, and location-scope
 * links are new.
 */

import {
  offerDiscountTypeLabels,
  offerDiscountTypeValues,
  offerStateLabels,
  offerStateValues,
} from '@borradh-workspace/features/shared';

import type {
  Offer as BackendOffer,
  OfferDiscountType as BackendOfferDiscountType,
  OfferState as BackendOfferState,
} from '@borradh-workspace/features/shared';

import type {
  CreateOfferInput as BackendCreateInput,
  UpdateOfferInput as BackendUpdateInput,
} from '@borradh-workspace/features/offers';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES + LABELS — runtime values for UI (dropdowns, badges, etc.)
// ============================================================================

export type OfferState = BackendOfferState;
export type OfferDiscountType = BackendOfferDiscountType;

export { offerStateLabels, offerStateValues };
export { offerDiscountTypeLabels, offerDiscountTypeValues };

// ============================================================================
// ENTITY TYPES — Date → string for API responses
// ============================================================================

/**
 * Offer response type. Dates are ISO strings on the wire; the new shape has
 * no `headline` / `bulletPoints` / `ctaText` / `urgencyText` / `audienceText`
 * / `isActive` / `type` — those are dropped from the schema.
 */
export type Offer = Serialize<BackendOffer>;

/**
 * Offer with linked service + location IDs (returned by get / list).
 *
 * `locationIds === []` means the offer applies to every org location
 * (empty-junction convention).
 */
export interface OfferWithServices {
  offer: Offer;
  serviceIds: string[];
  locationIds: string[];
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

export interface ListOffersResponse {
  items: (Offer & { serviceIds: string[]; locationIds: string[] })[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================================
// INPUT TYPES — Derived from backend, omitting server-side fields
// ============================================================================

/**
 * Create-offer payload sent by the frontend. `organizationId` is set by
 * the controller from the session.
 */
export type CreateOfferInput = Omit<BackendCreateInput, 'organizationId'>;

/**
 * Update-offer payload sent by the frontend. `id` is added from the URL
 * param, `organizationId` from the session.
 */
export type UpdateOfferInput = Omit<
  BackendUpdateInput,
  'id' | 'organizationId'
>;
