import type {
  creditChannelLabels,
  creditTransactionTypeLabels,
  subscriptionStatusLabels,
} from '@borradh-workspace/database';

/**
 * Credit usage channel types (derived from labels)
 */
export type CreditChannel = keyof typeof creditChannelLabels;

/**
 * Credit rates configuration (in precision units - actual credits * 100)
 */
export interface CreditRates {
  sms: number;
  email: number;
  voicePerMinute: number;
  whatsapp: number;
}

/**
 * Default credit rates
 */
export const DEFAULT_CREDIT_RATES: CreditRates = {
  sms: 100, // 1 credit
  email: 10, // 0.1 credits
  voicePerMinute: 500, // 5 credits per minute
  whatsapp: 100, // 1 credit
};

/**
 * Get credit cost for a channel
 */
export function getCreditCost(
  channel: CreditChannel,
  quantity = 1,
  rates: CreditRates = DEFAULT_CREDIT_RATES
): number {
  switch (channel) {
    case 'sms':
      return rates.sms * quantity;
    case 'email':
      return rates.email * quantity;
    case 'voice':
      return rates.voicePerMinute * quantity; // quantity is minutes
    case 'whatsapp':
      return rates.whatsapp * quantity;
    default:
      return 0;
  }
}

/**
 * Subscription status type (derived from labels)
 */
export type SubscriptionStatus = keyof typeof subscriptionStatusLabels;

/**
 * Credit transaction type (derived from labels)
 */
export type CreditTransactionType = keyof typeof creditTransactionTypeLabels;
