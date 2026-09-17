import type {
  Product,
  ProductBrand,
  ProductCategory,
  ProductStock,
  StockOrder,
  StockOrderFee,
  StockOrderItem,
  StockTake,
  StockTakeItem,
  Supplier,
} from '@borradh-workspace/database';

export type {
  Product,
  ProductBrand,
  ProductCategory,
  ProductStock,
  StockOrder,
  StockOrderFee,
  StockOrderItem,
  StockTake,
  StockTakeItem,
  Supplier,
};

/** Stock order with its line items and fees */
export interface StockOrderWithItems extends StockOrder {
  items: StockOrderItem[];
  fees: StockOrderFee[];
}

/** Stock take with its counted items */
export interface StockTakeWithItems extends StockTake {
  items: StockTakeItem[];
}
