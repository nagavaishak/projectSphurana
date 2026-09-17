import { defineCoverage } from '../coverage.types.js';

/**
 * STOCK-TAKES — 6 endpoints, 0 tools. A stocktake is a physical count: open a
 * session for a location, record counted quantities line by line, then complete
 * it — and completion writes the variance between counted and expected straight
 * onto on-hand stock.
 *
 * The reads are parked as `undecided` on the same footing as stock-orders. The
 * writes are the clearest case in this batch for keeping Claire out, and the
 * reason is not policy but physics: the entire value of a stocktake is that a
 * human walked the shelves and counted. A count invented from expected
 * quantities is not a stocktake, it is a rubber stamp that destroys the one
 * number the process exists to produce.
 */
export const stockTakesCoverage = defineCoverage('stock-takes', {
  // ---- reads -------------------------------------------------------------
  'GET /stock-takes': { undecided: 'ENG-CLAIRE-STOCK-TAKES' },
  'GET /stock-takes/:id': { undecided: 'ENG-CLAIRE-STOCK-TAKES' },

  // ---- writes ------------------------------------------------------------
  'POST /stock-takes': {
    notExposed:
      'Opens a counting session against a location, which staff are then expected to work through. Starting one nobody asked for leaves an open session blocking the next real count.',
  },
  'PUT /stock-takes/:id/items': {
    notExposed:
      'Records counted quantities. The whole point of the number is that a person physically counted it; anything Claire could supply is the expected figure she is meant to be checking against.',
  },
  'POST /stock-takes/:id/complete': {
    notExposed:
      'Completion applies the counted-versus-expected variance to on-hand stock and writes off the difference as shrinkage. It is the irreversible commit of the whole count.',
  },
  'POST /stock-takes/:id/cancel': {
    notExposed:
      'Discards a count in progress, throwing away work staff have already done on the shop floor.',
  },
});
