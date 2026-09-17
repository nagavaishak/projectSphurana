import { defineCoverage } from '../coverage.types.js';

/**
 * SUPPLIERS — 4 endpoints, 0 tools. The trade-account address book that stock
 * orders are raised against: name, contact details, account reference.
 *
 * Plain CRUD, and the split follows the batch's default. The list read is
 * harmless back-office context and is parked as `undecided`. The writes are
 * refused not because they are dangerous in themselves but because a supplier
 * record is transcription of a real commercial relationship — an account number
 * and an ordering email off a trade agreement — with nothing for Claire to
 * reason about and a real cost if she gets a digit wrong: purchase orders go to
 * the wrong address.
 */
export const suppliersCoverage = defineCoverage('suppliers', {
  // ---- reads -------------------------------------------------------------
  'GET /suppliers': { undecided: 'ENG-CLAIRE-SUPPLIERS' },

  // ---- writes ------------------------------------------------------------
  'POST /suppliers': {
    notExposed:
      'Transcribes a real trade account — ordering email, account reference, contact — off a supplier agreement. Nothing here is inferable, and a wrong address sends purchase orders into the void.',
  },
  'PUT /suppliers/:id': {
    notExposed:
      'Same transcription problem, with the added risk of silently redirecting where existing purchase orders are sent.',
  },
  'DELETE /suppliers/:id': {
    notExposed:
      'Removes a supplier that historic stock orders reference, breaking the purchase audit trail. Reversible only from a backup.',
  },
});
