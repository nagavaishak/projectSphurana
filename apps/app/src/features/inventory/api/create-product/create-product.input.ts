import type { ProductMeasureUnit } from '../types';

/**
 * Typed intent for creating OR updating a product. This is the raw shape the
 * product form naturally holds (form-field strings + toggles), NOT the wire
 * body. `buildProductWritePayload` turns it into the single wire body used by
 * both the create (POST) and update (PUT) hooks.
 *
 * `markupRaw` from the form is intentionally excluded — markup is a
 * presentational field computed from supply/retail and is never persisted.
 */
export interface ProductWriteIntent {
  name: string;
  images: string[];
  barcode: string;
  brandId: string | null;
  measureUnit: ProductMeasureUnit;
  measureAmount: string;
  description: string;
  categoryId: string | null;
  supplyRaw: string;
  retailEnabled: boolean;
  isMedication: boolean;
  onlineEnabled: boolean;
  shippable: boolean;
  retailRaw: string;
  taxCode: string;
  teamMemberCommissionEnabled: boolean;
  skus: string[];
  supplierId: string | null;
  trackStock: boolean;
  lowStockLevel: string;
  reorderQuantity: string;
  lowStockNotify: boolean;
}
