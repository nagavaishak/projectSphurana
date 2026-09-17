/** A raw per-item receive draft (the quantity typed for this receipt event). */
export interface ReceiveItemDraft {
  itemId: string;
  rawQuantity: string;
}

/**
 * Typed intent for receiving a stock order. The raw drafts, NOT the wire body;
 * `buildReceiveStockOrderPayload` parses each quantity and drops zero rows.
 */
export interface ReceiveStockOrderIntent {
  itemDrafts: ReceiveItemDraft[];
}
