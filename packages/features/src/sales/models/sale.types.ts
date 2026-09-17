import type { Sale, SaleItem, SalePayment } from '@borradh-workspace/database';

export type { Sale, SaleItem, SalePayment };

/** Minimal client snapshot attached to a sale for list/detail rendering. */
export interface SaleLeadRef {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

/** Minimal location snapshot attached to a sale. */
export interface SaleLocationRef {
  id: string;
  name: string | null;
}

/** Minimal creator (team member) snapshot attached to a sale. */
export interface SaleUserRef {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

/** Sale with its line items and payments (tenders). */
export interface SaleWithRelations extends Sale {
  items: SaleItem[];
  payments: SalePayment[];
  /** Client the sale is attributed to (null for walk-ins). Optional: not all
   * code paths that build a SaleWithRelations load the relation. */
  lead?: SaleLeadRef | null;
  /** Location the sale was rung up at. */
  location?: SaleLocationRef | null;
  /** Team member who created the sale. */
  createdBy?: SaleUserRef | null;
}

/** One row of the daily transaction summary (per item type). */
export interface SaleDailySummaryItemRow {
  salesQty: number;
  refundQty: number;
  grossCents: number;
}

/** One row of the daily cash-movement summary (per payment method). */
export interface SaleDailySummaryMethodRow {
  collectedCents: number;
  refundsCents: number;
}

/** Aggregated daily POS summary (completed sales only). */
export interface SaleDailySummary {
  date: string;
  /** Org currency (from the primary location country), lowercase ISO. */
  currency: string;
  saleCount: number;
  totalCents: number;
  tipCents: number;
  /** Succeeded tender totals keyed by payment method. */
  byMethod: Record<string, number>;
  /** Line totals keyed by item type. */
  byItemType: Record<string, number>;
  /** Transaction summary rows keyed by item type (qty + gross). */
  itemRows: Record<string, SaleDailySummaryItemRow>;
  /** Cash-movement rows keyed by payment method (collected + refunds). */
  methodRows: Record<string, SaleDailySummaryMethodRow>;
}
