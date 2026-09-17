/**
 * @borradh-workspace/api-client - Billing API Types
 *
 * Types for the billing API endpoints.
 * Types are derived from backend packages - database enums and features schemas.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  CreditBalance as BackendCreditBalance,
  CreditTransaction as BackendCreditTransaction,
  Invoice as BackendInvoice,
  Subscription as BackendSubscription,
  CreditChannel,
  CreditTransactionType,
  InvoiceStatus,
  SubscriptionStatus,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  creditChannelLabels,
  creditChannelValues,
  creditTransactionTypeLabels,
  creditTransactionTypeValues,
  invoiceStatusLabels,
  invoiceStatusValues,
  subscriptionStatusLabels,
  subscriptionStatusValues,
} from '@borradh-workspace/features/shared';

// Import backend input types from features
import type {
  CreateCreditsCheckoutInput as BackendCreateCreditsCheckoutInput,
  CreatePortalSessionInput as BackendCreatePortalSessionInput,
  CreateSubscriptionCheckoutInput as BackendCreateSubscriptionCheckoutInput,
} from '@borradh-workspace/features/billing';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

/**
 * Subscription status type - re-exported from database
 */
export type { SubscriptionStatus };

/**
 * Credit transaction type - re-exported from database
 */
export type { CreditTransactionType };

/**
 * Credit channel type - re-exported from database
 */
export type { CreditChannel };

/**
 * Invoice status type - re-exported from database
 */
export type { InvoiceStatus };

/**
 * Labels and values for UI usage (dropdowns, badges, etc.)
 */
export {
  subscriptionStatusLabels,
  subscriptionStatusValues,
  creditTransactionTypeLabels,
  creditTransactionTypeValues,
  creditChannelLabels,
  creditChannelValues,
  invoiceStatusLabels,
  invoiceStatusValues,
};

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Subscription entity type (API response - dates serialized to ISO strings)
 */
export type Subscription = Serialize<BackendSubscription>;

/**
 * Credit balance entity type (API response)
 */
export type CreditBalance = Serialize<BackendCreditBalance>;

/**
 * Credit transaction entity type (API response)
 */
export type CreditTransaction = Serialize<BackendCreditTransaction>;

/**
 * Invoice entity type (API response)
 */
export type Invoice = Serialize<BackendInvoice>;

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * Subscription response wrapper
 */
export interface SubscriptionResponse {
  subscription: Subscription | null;
}

/**
 * Credit balance response with human-readable values
 */
export interface CreditBalanceResponse {
  balance: {
    id: string;
    organizationId: string;
    balance: number;
    includedCredits: number;
    purchasedCredits: number;
    creditsAvailable: number; // Human-readable (balance / 100)
    includedMonthly: number; // Human-readable (includedCredits / 100)
  } | null;
}

/**
 * Credit package for purchase
 */
export interface CreditPackage {
  id: string;
  name: string;
  credits: number; // Human-readable
  priceInCents: number;
  priceFormatted: string;
  popular?: boolean;
}

/**
 * Credit packages response
 */
export interface CreditPackagesResponse {
  packages: CreditPackage[];
}

/**
 * Supported currencies for subscription pricing
 */
export type SupportedCurrency = 'usd' | 'eur' | 'gbp';

/**
 * Currency-specific price info
 */
export interface CurrencyPrice {
  stripePriceId: string;
  priceInCents: number;
}

/**
 * Billing plan info
 */
export interface BillingPlan {
  id: string;
  name: string;
  priceInCents: number;
  includedCredits: number; // Human-readable
  priceFormatted: string;
  features?: string[];
  currencyPrices?: Partial<Record<SupportedCurrency, CurrencyPrice>>;
}

/**
 * Plan info response
 */
export interface PlanInfoResponse {
  plan: BillingPlan;
}

/**
 * Checkout session result
 */
export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/**
 * Input for creating subscription checkout
 * Omits organizationId and customerEmail (added by controller from session)
 */
export type CreateSubscriptionCheckoutInput = Omit<
  BackendCreateSubscriptionCheckoutInput,
  'organizationId' | 'customerEmail'
>;

/**
 * Input for creating credits checkout
 * Omits organizationId (added by controller from session)
 */
export type CreateCreditsCheckoutInput = Omit<
  BackendCreateCreditsCheckoutInput,
  'organizationId'
>;

/**
 * Input for creating portal session
 * Omits organizationId (added by controller from session)
 */
export type CreatePortalSessionInput = Omit<
  BackendCreatePortalSessionInput,
  'organizationId'
>;

/**
 * Portal session result
 */
export interface PortalSessionResult {
  url: string;
}
