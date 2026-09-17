/**
 * Billing types for the frontend
 *
 * Re-exports from @borradh-workspace/api-client/types following the type-sharing pattern.
 * See: .claude/rules/_patterns/type-sharing.md
 *
 * DO NOT define types here - import from api-client to ensure type consistency.
 */

// Entity and enum types
export type {
  Subscription,
  SubscriptionStatus,
  CreditBalance,
  CreditTransaction,
  CreditTransactionType,
  CreditChannel,
  Invoice,
  InvoiceStatus,
} from '@borradh-workspace/api-client/types';

// Response types
export type {
  SubscriptionResponse,
  CreditBalanceResponse,
  CreditPackage,
  CreditPackagesResponse,
  BillingPlan,
  CurrencyPrice,
  SupportedCurrency,
  PlanInfoResponse,
  CheckoutSessionResult,
  PortalSessionResult,
} from '@borradh-workspace/api-client/types';

// Input types
export type {
  CreateSubscriptionCheckoutInput,
  CreateCreditsCheckoutInput,
  CreatePortalSessionInput,
} from '@borradh-workspace/api-client/types';

// Labels and values for UI components (dropdowns, badges, etc.)
export {
  subscriptionStatusLabels,
  subscriptionStatusValues,
  creditTransactionTypeLabels,
  creditTransactionTypeValues,
  creditChannelLabels,
  creditChannelValues,
  invoiceStatusLabels,
  invoiceStatusValues,
} from '@borradh-workspace/api-client/types';
