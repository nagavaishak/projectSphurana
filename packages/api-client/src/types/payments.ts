/**
 * @borradh-workspace/api-client - Payments API Types
 *
 * Types for the payments API endpoints.
 * Types are derived from backend packages - database types and features schemas.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type { PaymentStatus } from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  paymentStatusLabels,
  paymentStatusValues,
} from '@borradh-workspace/features/shared';

// Import backend entity types from features
import type { Payment as BackendPayment } from '@borradh-workspace/features/payments';

// Import backend input types from features
import type {
  CreatePaymentInput as BackendCreatePaymentInput,
  ListPaymentsInput as BackendListPaymentsInput,
  RefundPaymentInput as BackendRefundPaymentInput,
} from '@borradh-workspace/features/payments';

import type { Serialize } from './serialization.js';
import type { PaginatedResponse } from './shared.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

export type { PaymentStatus };
export { paymentStatusLabels, paymentStatusValues };

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Payment entity type (API response - dates serialized to ISO strings)
 */
export type Payment = Serialize<BackendPayment>;

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * List payments response
 */
export interface PaymentListResponse extends PaginatedResponse<Payment> {}

/**
 * Create payment response - payment + checkout URL
 */
export interface CreatePaymentResponse {
  payment: Payment;
  checkoutUrl: string;
}

/**
 * Refund payment response
 */
export interface RefundPaymentResponse {
  payment: Payment;
  refundId: string;
}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/**
 * Input for creating a payment
 * Omits organizationId (added by controller from session)
 */
export type CreatePaymentInput = Omit<
  BackendCreatePaymentInput,
  'organizationId'
>;

/**
 * Parameters for listing payments
 * Omits organizationId (added by controller from session)
 */
export type ListPaymentsInput = Omit<
  BackendListPaymentsInput,
  'organizationId'
>;

/**
 * Input for refunding a payment
 * Omits paymentId, organizationId (paymentId from route param, organizationId from session)
 */
export type RefundPaymentInput = Omit<
  BackendRefundPaymentInput,
  'paymentId' | 'organizationId'
>;
