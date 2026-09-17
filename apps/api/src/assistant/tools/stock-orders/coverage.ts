import { defineCoverage } from '../coverage.types.js';

/**
 * STOCK-ORDERS — 6 endpoints, 0 tools. Purchase orders to suppliers: draft the
 * order, send it, then receive against it — and receiving is what increments
 * on-hand stock for a location.
 *
 * The two reads are parked as `undecided`: "is the shampoo order in yet?" is a
 * reasonable thing to ask, and nothing about a PO is sensitive to the owner who
 * raised it. The writes are refused because a purchase order commits the
 * business to spending real money with a third party, and `receive` is a claim
 * that boxes physically arrived — the ledger write that valuation and reorder
 * points depend on.
 */
export const stockOrdersCoverage = defineCoverage('stock-orders', {
  // ---- reads -------------------------------------------------------------
  'GET /stock-orders': { undecided: 'ENG-CLAIRE-STOCK-ORDERS' },
  'GET /stock-orders/:id': { undecided: 'ENG-CLAIRE-STOCK-ORDERS' },

  // ---- writes ------------------------------------------------------------
  'POST /stock-orders': {
    notExposed:
      'Raises a purchase order that commits the business to spending money with a supplier. Quantities and unit costs come off a supplier price list a human is working from.',
  },
  'PUT /stock-orders/:id': {
    notExposed:
      'Edits the lines and totals of a purchase order that may already have been sent to the supplier, putting the system’s copy out of step with theirs.',
  },
  'POST /stock-orders/:id/receive': {
    notExposed:
      'Receiving asserts that goods physically arrived and increments on-hand stock per location. Only the person unpacking the delivery can count what turned up against what was ordered.',
  },
  'POST /stock-orders/:id/cancel': {
    notExposed:
      'Cancels an order the supplier may already be fulfilling. Getting the system and the supplier out of agreement about a live order is a commercial mess a human has to unpick.',
  },
});
