/**
 * @borradh-workspace/api-client - Gift Cards API Types
 */

// Import types from features/shared (isolatedModules compliant)
import type {
  GiftCardExpiry,
  GiftCardTransactionType,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  giftCardExpiryLabels,
  giftCardExpiryValues,
  giftCardTransactionTypeLabels,
  giftCardTransactionTypeValues,
} from '@borradh-workspace/features/shared';

// Import backend entity + input types from features
import type {
  AdjustGiftCardInput as BackendAdjustGiftCardInput,
  GiftCardWithTransactions as BackendGiftCardWithTransactions,
  ListGiftCardsInput as BackendListGiftCardsInput,
} from '@borradh-workspace/features/gift-cards';
import type {
  GiftCard as BackendGiftCard,
  GiftCardTransaction as BackendGiftCardTransaction,
} from '@borradh-workspace/features/shared';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported (Labels pattern)
// ============================================================================

export type { GiftCardTransactionType, GiftCardExpiry };
export {
  giftCardTransactionTypeLabels,
  giftCardTransactionTypeValues,
  giftCardExpiryLabels,
  giftCardExpiryValues,
};

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

export type GiftCard = Serialize<BackendGiftCard>;
export type GiftCardTransaction = Serialize<BackendGiftCardTransaction>;
export type GiftCardWithTransactions =
  Serialize<BackendGiftCardWithTransactions>;

// ============================================================================
// RESPONSE TYPES
// ============================================================================

export interface GiftCardListResponse {
  items: GiftCard[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

export type ListGiftCardsInput = Omit<
  BackendListGiftCardsInput,
  'organizationId'
>;

export type AdjustGiftCardInput = Omit<
  BackendAdjustGiftCardInput,
  'organizationId' | 'giftCardId' | 'createdById'
>;
