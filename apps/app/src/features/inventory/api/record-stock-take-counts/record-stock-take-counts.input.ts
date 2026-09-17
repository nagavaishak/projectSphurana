/** A raw per-item count draft as typed into the stocktake count dialog. */
export interface StockTakeCountDraft {
  itemId: string;
  rawCount: string;
}

/**
 * Typed intent for recording stocktake counts. The raw drafts, NOT the wire
 * body; `buildRecordStockTakeCountsPayload` parses each count and drops rows
 * that are blank or not a valid non-negative integer.
 */
export interface RecordStockTakeCountsIntent {
  itemDrafts: StockTakeCountDraft[];
}
