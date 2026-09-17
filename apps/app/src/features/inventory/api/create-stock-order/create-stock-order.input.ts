import type { StockOrderFeeType } from '../types';

/** A raw line-item row as held by the create-stock-order form. */
export interface StockOrderItemRowIntent {
  productId: string | null;
  quantity: string;
  costRaw: string;
}

/** A raw fee row as held by the create-stock-order form. */
export interface StockOrderFeeRowIntent {
  name: string;
  type: StockOrderFeeType;
  valueRaw: string;
}

/**
 * Typed intent for creating a stock order — the raw form state, NOT the wire
 * body. `buildCreateStockOrderPayload` performs every derivation (quantity /
 * cost parsing, fee cents-vs-basis-points conversion, zero-product filtering,
 * null-coalescing) and validation.
 */
export interface CreateStockOrderIntent {
  supplierId: string | null;
  locationId: string | null;
  expectedByDate: Date | null;
  notes: string;
  itemRows: StockOrderItemRowIntent[];
  feeRows: StockOrderFeeRowIntent[];
}
