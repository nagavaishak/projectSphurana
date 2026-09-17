/**
 * @borradh-workspace/api-client - Inventory API Types
 *
 * Types for the inventory API endpoints (products, brands, suppliers,
 * categories, per-location stock, stock orders, stock takes).
 * Types are derived from backend packages - database types and features schemas.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  ProductMeasureUnit,
  StockOrderFeeType,
  StockOrderStatus,
  StockTakeStatus,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  productMeasureUnitLabels,
  productMeasureUnitValues,
  stockOrderFeeTypeLabels,
  stockOrderFeeTypeValues,
  stockOrderStatusLabels,
  stockOrderStatusValues,
  stockTakeStatusLabels,
  stockTakeStatusValues,
} from '@borradh-workspace/features/shared';

// Import backend entity types from features
import type {
  Product as BackendProduct,
  ProductBrand as BackendProductBrand,
  ProductCategory as BackendProductCategory,
  ProductStock as BackendProductStock,
  StockOrder as BackendStockOrder,
  StockOrderFee as BackendStockOrderFee,
  StockOrderItem as BackendStockOrderItem,
  StockOrderWithItems as BackendStockOrderWithItems,
  StockTake as BackendStockTake,
  StockTakeItem as BackendStockTakeItem,
  StockTakeWithItems as BackendStockTakeWithItems,
  Supplier as BackendSupplier,
} from '@borradh-workspace/features/inventory';

// Import backend input types from features
import type {
  AdjustProductStockInput as BackendAdjustProductStockInput,
  CreateProductBrandInput as BackendCreateProductBrandInput,
  CreateProductCategoryInput as BackendCreateProductCategoryInput,
  CreateProductInput as BackendCreateProductInput,
  CreateStockOrderInput as BackendCreateStockOrderInput,
  CreateStockTakeInput as BackendCreateStockTakeInput,
  CreateSupplierInput as BackendCreateSupplierInput,
  ListProductsInput as BackendListProductsInput,
  ListStockOrdersInput as BackendListStockOrdersInput,
  ListStockTakesInput as BackendListStockTakesInput,
  ReceiveStockOrderInput as BackendReceiveStockOrderInput,
  RecordStockTakeCountsInput as BackendRecordStockTakeCountsInput,
  UpdateProductBrandInput as BackendUpdateProductBrandInput,
  UpdateProductCategoryInput as BackendUpdateProductCategoryInput,
  UpdateProductInput as BackendUpdateProductInput,
  UpdateStockOrderInput as BackendUpdateStockOrderInput,
  UpdateSupplierInput as BackendUpdateSupplierInput,
} from '@borradh-workspace/features/inventory';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

export type {
  ProductMeasureUnit,
  StockOrderStatus,
  StockOrderFeeType,
  StockTakeStatus,
};
export {
  productMeasureUnitLabels,
  productMeasureUnitValues,
  stockOrderStatusLabels,
  stockOrderStatusValues,
  stockOrderFeeTypeLabels,
  stockOrderFeeTypeValues,
  stockTakeStatusLabels,
  stockTakeStatusValues,
};

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

export type Product = Serialize<BackendProduct>;
export type ProductBrand = Serialize<BackendProductBrand>;
export type Supplier = Serialize<BackendSupplier>;
export type ProductCategory = Serialize<BackendProductCategory>;
export type ProductStock = Serialize<BackendProductStock>;
export type StockOrder = Serialize<BackendStockOrder>;
export type StockOrderItem = Serialize<BackendStockOrderItem>;
export type StockOrderFee = Serialize<BackendStockOrderFee>;
export type StockOrderWithItems = Serialize<BackendStockOrderWithItems>;
export type StockTake = Serialize<BackendStockTake>;
export type StockTakeItem = Serialize<BackendStockTakeItem>;
export type StockTakeWithItems = Serialize<BackendStockTakeWithItems>;

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * A listed product plus the branches that stock it.
 *
 * EMPTY MEANS EVERY BRANCH — the empty-junction convention, not "stocked
 * nowhere". LIST only, mirroring `ListedService`: the import dialog needs to
 * tell "already here" from "available to copy". Per-branch QUANTITY is
 * `ProductStock`, a different thing.
 */
export type ListedProduct = Product & { locationIds: string[] };

export interface ProductListResponse {
  items: ListedProduct[];
  total: number;
  limit: number;
  offset: number;
}

export interface StockOrderListResponse {
  items: StockOrder[];
  total: number;
  limit: number;
  offset: number;
}

export interface StockTakeListResponse {
  items: StockTake[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

export type CreateProductInput = Omit<
  BackendCreateProductInput,
  'organizationId'
>;
export type UpdateProductInput = Omit<
  BackendUpdateProductInput,
  'id' | 'organizationId'
>;
export type ListProductsInput = Omit<
  BackendListProductsInput,
  'organizationId'
>;
export type AdjustStockInput = Omit<
  BackendAdjustProductStockInput,
  'organizationId' | 'productId' | 'locationId'
>;

export type CreateProductBrandInput = Omit<
  BackendCreateProductBrandInput,
  'organizationId'
>;
export type UpdateProductBrandInput = Omit<
  BackendUpdateProductBrandInput,
  'id' | 'organizationId'
>;
export type CreateSupplierInput = Omit<
  BackendCreateSupplierInput,
  'organizationId'
>;
export type UpdateSupplierInput = Omit<
  BackendUpdateSupplierInput,
  'id' | 'organizationId'
>;
export type CreateProductCategoryInput = Omit<
  BackendCreateProductCategoryInput,
  'organizationId'
>;
export type UpdateProductCategoryInput = Omit<
  BackendUpdateProductCategoryInput,
  'id' | 'organizationId'
>;

export type CreateStockOrderInput = Omit<
  BackendCreateStockOrderInput,
  'organizationId' | 'createdById'
>;
export type UpdateStockOrderInput = Omit<
  BackendUpdateStockOrderInput,
  'id' | 'organizationId'
>;
export type ListStockOrdersInput = Omit<
  BackendListStockOrdersInput,
  'organizationId'
>;
export type ReceiveStockOrderInput = Omit<
  BackendReceiveStockOrderInput,
  'organizationId' | 'stockOrderId'
>;

export type CreateStockTakeInput = Omit<
  BackendCreateStockTakeInput,
  'organizationId' | 'createdById'
>;
export type ListStockTakesInput = Omit<
  BackendListStockTakesInput,
  'organizationId'
>;
export type RecordStockTakeCountsInput = Omit<
  BackendRecordStockTakeCountsInput,
  'organizationId' | 'stockTakeId'
>;
