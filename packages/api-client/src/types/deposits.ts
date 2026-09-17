/**
 * @borradh-workspace/api-client - Deposit API Types
 *
 * Types for the deposits API endpoints (Stripe Connect).
 * Types are derived from backend packages - database enums and features schemas.
 *
 * Following type-sharing pattern: .claude/rules/_patterns/type-sharing.md
 * - Response types use Serialize<T> (Date → string)
 * - Input types use Serialize<T> since JSON sends dates as ISO strings
 */

// Import labels and values from features/shared (re-exported from database)
import {
  depositBasisLabels,
  depositBasisValues,
  depositStatusLabels,
  depositStatusValues,
} from '@borradh-workspace/features/shared';

// Import backend types from features/shared
import type {
  AppointmentDeposit as BackendAppointmentDeposit,
  StripeConnectIntegration as BackendStripeConnectIntegration,
} from '@borradh-workspace/features/shared';

import type {
  CreateDepositRequestInput as BackendCreateDepositRequestInput,
  ListDepositsInput as BackendListDepositsInput,
} from '@borradh-workspace/features/appointments';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Derived from database labels (single source of truth)
// ============================================================================

/**
 * Deposit status type - derived from labels
 */
export type DepositStatus = keyof typeof depositStatusLabels;

/**
 * Labels and values for UI usage (dropdowns, badges, etc.)
 */
export { depositStatusLabels, depositStatusValues };

/** How a deposit amount is worked out — a share of the price, or a flat figure. */
export type DepositBasis = keyof typeof depositBasisLabels;
export { depositBasisLabels, depositBasisValues };

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Deposit entity type (API response - dates serialized to ISO strings)
 */
export type Deposit = Serialize<BackendAppointmentDeposit>;

/**
 * Stripe Connect integration entity type
 */
export type StripeConnectIntegration =
  Serialize<BackendStripeConnectIntegration>;

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * List response for deposits
 */
export interface DepositListResponse {
  items: Deposit[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Response when creating a deposit request
 */
export interface CreateDepositResponse {
  deposit: Deposit;
  checkoutUrl: string;
}

/**
 * Response when refunding a deposit
 */
export interface RefundDepositResponse {
  deposit: Deposit;
  refundId: string;
}

// ============================================================================
// INPUT TYPES - Derived from backend, serialized for JSON transport
// ============================================================================

/**
 * Input for creating a deposit request
 * - Omits organizationId (added by controller from session)
 */
export type CreateDepositInput = Omit<
  BackendCreateDepositRequestInput,
  'organizationId'
>;

/**
 * Parameters for listing deposits
 * - Omits organizationId (added by controller from session)
 */
export type ListDepositsParams = Omit<
  BackendListDepositsInput,
  'organizationId'
>;

/**
 * Input for refunding a deposit
 */
export interface RefundDepositInput {
  depositId: string;
  reason?: string;
}
