import { defineCoverage } from '../coverage.types.js';

/**
 * PRODUCTS — 7 endpoints, 0 tools. The retail catalogue: physical goods with a
 * SKU, a barcode, a cost and a retail price, plus per-location stock levels
 * that the sales, stock-order and stock-take flows all write through.
 *
 * The two reads and the stock read are ordinary questions ("are we low on
 * anything?", "what do we charge for that?") and are parked as `undecided`.
 * Everything else is refused on the same principle: a product row is a claim
 * about an object on a shelf. Claire cannot see the shelf, cannot read the
 * barcode, and cannot count what is on it — and `PUT /:id/stock/:locationId`
 * writes the stock ledger that inventory valuation and reorder points are
 * computed from.
 */
export const productsCoverage = defineCoverage('products', {
  // ---- reads -------------------------------------------------------------
  'GET /products': { undecided: 'ENG-CLAIRE-PRODUCTS' },
  'GET /products/:id': { undecided: 'ENG-CLAIRE-PRODUCTS' },
  'GET /products/:id/stock': { undecided: 'ENG-CLAIRE-PRODUCTS' },

  // ---- writes ------------------------------------------------------------
  'POST /products': {
    notExposed:
      'Creating a product asserts a SKU, barcode, supplier cost and retail price for a physical item. Every one of those is read off the packaging or an invoice in front of someone, and a guessed cost quietly corrupts margin reporting.',
  },
  'PUT /products/:id': {
    notExposed:
      'Same problem as creation, with the added risk that a retail price edit changes what customers are charged at the till from the next sale onwards.',
  },
  'DELETE /products/:id': {
    notExposed:
      'Removes a product that historic sale lines and stock movements point at. Destructive to the inventory audit trail and reversible only from a backup.',
  },
  'PUT /products/:id/locations': {
    notExposed:
      'Replaces which branches stock this SKU. Same mechanical hazard as `PUT /organization-services/:id/locations`: a full replace whose EMPTY body means "stocked at every branch", so the natural reading of "remove it from Cork" inverts. Distinct from the quantity endpoint below — this one says whether the SKU is sold there at all, not how many are on the shelf.',
  },
  'PUT /products/:id/stock/:locationId': {
    notExposed:
      'Writes the on-hand quantity for a location — the stock ledger that valuation, low-stock alerts and reordering all read. A count is a physical act, and there is a deliberate route for it (stock-takes) performed by someone holding the stock.',
  },
  'DELETE /products/:id/locations/:locationId': {
    notExposed:
      "Stops stocking a product at one branch. Claire has no product surface at all, so this is unreachable for the same reason as the POST — and removal is the more consequential half, since it takes a line off a branch's till.",
  },

  'POST /products/:id/locations': {
    notExposed:
      'Adds branches that stock a product. Additive and safe in shape, but Claire has NO product surface — zero tools in this area — so she cannot read the catalogue she would be moving a SKU around in, and per-branch quantity (`product_stock`) is a separate concept she also cannot see. Retail stock is dashboard administration today.',
  },
});
