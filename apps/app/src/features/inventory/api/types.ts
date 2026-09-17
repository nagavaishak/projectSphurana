/**
 * Inventory types for the frontend.
 *
 * Re-exports from @borradh-workspace/api-client/types following the
 * type-sharing pattern. DO NOT define entity types here.
 */

export type {
  Product,
  ProductBrand,
  Supplier,
  ProductCategory,
  ProductStock,
  StockOrder,
  StockOrderItem,
  StockOrderFee,
  StockOrderWithItems,
  StockTake,
  StockTakeItem,
  StockTakeWithItems,
  ProductMeasureUnit,
  StockOrderStatus,
  StockOrderFeeType,
  StockTakeStatus,
  ProductListResponse,
  StockOrderListResponse,
  StockTakeListResponse,
  CreateProductInput,
  UpdateProductInput,
  ListProductsInput,
  AdjustStockInput,
  CreateProductBrandInput,
  UpdateProductBrandInput,
  CreateSupplierInput,
  UpdateSupplierInput,
  CreateProductCategoryInput,
  UpdateProductCategoryInput,
  CreateStockOrderInput,
  UpdateStockOrderInput,
  ListStockOrdersInput,
  ReceiveStockOrderInput,
  CreateStockTakeInput,
  ListStockTakesInput,
  RecordStockTakeCountsInput,
} from '@borradh-workspace/api-client/types';

export {
  productMeasureUnitLabels,
  productMeasureUnitValues,
  stockOrderStatusLabels,
  stockOrderStatusValues,
  stockOrderFeeTypeLabels,
  stockOrderFeeTypeValues,
  stockTakeStatusLabels,
  stockTakeStatusValues,
} from '@borradh-workspace/api-client/types';
