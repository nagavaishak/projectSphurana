/**
 * @borradh-workspace/api-client - Sales / POS API Types
 *
 * Types for the sales endpoints. Derived from backend packages —
 * database entities via features, features schemas for inputs.
 */

// Import types from features/shared (isolatedModules compliant)
import type {
  SaleFulfilmentMethod,
  SaleFulfilmentStatus,
  SaleItemType,
  SalePaymentMethod,
  SalePaymentStatus,
  SaleStatus,
  SaleTipType,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  saleFulfilmentMethodLabels,
  saleFulfilmentMethodValues,
  saleFulfilmentStatusLabels,
  saleFulfilmentStatusValues,
  saleItemTypeLabels,
  saleItemTypeValues,
  salePaymentMethodLabels,
  salePaymentMethodValues,
  salePaymentStatusLabels,
  salePaymentStatusValues,
  saleStatusLabels,
  saleStatusValues,
  saleTipTypeLabels,
  saleTipTypeValues,
} from '@borradh-workspace/features/shared';

// Import backend entity + input types from features
import type {
  AddSaleItemInput as BackendAddSaleItemInput,
  AddSalePaymentInput as BackendAddSalePaymentInput,
  AddSalePaymentResult as BackendAddSalePaymentResult,
  CreateSaleInput as BackendCreateSaleInput,
  GetDailySummaryInput as BackendGetDailySummaryInput,
  ListSalesInput as BackendListSalesInput,
  Sale as BackendSale,
  SaleDailySummary as BackendSaleDailySummary,
  SaleItem as BackendSaleItem,
  SalePayment as BackendSalePayment,
  SaleWithRelations as BackendSaleWithRelations,
  SetSaleClientInput as BackendSetSaleClientInput,
  SetSaleTipInput as BackendSetSaleTipInput,
} from '@borradh-workspace/features/sales';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported (Labels pattern)
// ============================================================================

export type {
  SaleStatus,
  SaleTipType,
  SaleItemType,
  SalePaymentMethod,
  SalePaymentStatus,
  SaleFulfilmentMethod,
  SaleFulfilmentStatus,
};
export {
  saleStatusLabels,
  saleStatusValues,
  saleTipTypeLabels,
  saleTipTypeValues,
  saleItemTypeLabels,
  saleItemTypeValues,
  salePaymentMethodLabels,
  salePaymentMethodValues,
  salePaymentStatusLabels,
  salePaymentStatusValues,
  saleFulfilmentMethodLabels,
  saleFulfilmentMethodValues,
  saleFulfilmentStatusLabels,
  saleFulfilmentStatusValues,
};

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

export type Sale = Serialize<BackendSale>;
export type SaleItem = Serialize<BackendSaleItem>;
export type SalePayment = Serialize<BackendSalePayment>;
export type SaleWithRelations = Serialize<BackendSaleWithRelations>;
export type SaleDailySummary = Serialize<BackendSaleDailySummary>;

/** POST /sales/:id/payments response — sale plus tender-specific extras. */
export type AddSalePaymentResponse = Serialize<BackendAddSalePaymentResult>;

// ============================================================================
// RESPONSE TYPES
// ============================================================================

export interface SaleListResponse {
  items: SaleWithRelations[];
  total: number;
  limit: number;
  offset: number;
}

/** Serialized subset of a Stripe Terminal reader (readers live in Stripe
 * only — no local table; contract §7.B). */
export interface TerminalReader {
  id: string;
  label: string | null;
  deviceType: string;
  status: string | null;
  locationId: string | null;
}

export interface TerminalConnectionTokenResponse {
  secret: string;
}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

export type CreateSaleInput = Omit<
  BackendCreateSaleInput,
  'organizationId' | 'createdById'
>;

export type ListSalesInput = Omit<BackendListSalesInput, 'organizationId'>;

export type AddSaleItemInput = Omit<
  BackendAddSaleItemInput,
  'organizationId' | 'saleId'
>;

export type SetSaleTipInput = Omit<
  BackendSetSaleTipInput,
  'organizationId' | 'saleId'
>;

export type SetSaleClientInput = Omit<
  BackendSetSaleClientInput,
  'organizationId' | 'saleId'
>;

export type AddSalePaymentInput = Omit<
  BackendAddSalePaymentInput,
  'organizationId' | 'saleId' | 'createdById'
>;

export type GetDailySummaryInput = Omit<
  BackendGetDailySummaryInput,
  'organizationId'
>;

export interface RegisterTerminalReaderInput {
  registrationCode: string;
  label: string;
  locationId: string;
}
