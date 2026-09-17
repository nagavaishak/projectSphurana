import { defineCoverage } from '../coverage.types.js';

/**
 * PACKAGES — 9 endpoints, 0 tools. A package is a bundle of services sold as
 * one item (a course of six treatments, a bridal bundle), built from an ordered
 * list of package items. Two of them are a genuine Claire gap: she already
 * pitches offers and services through `offers_*` and `context_listServices`,
 * and a package is the third thing an owner sells — so not being able to read
 * the catalogue is a dead end mid-conversation.
 *
 * The writes are a different matter. A package is what the business SELLS —
 * its price, its contents, what a customer is charged for it — so an owner
 * edits it deliberately in the catalogue, not in passing through a chat. The
 * item routes below it are a drag-and-drop builder whose reorder endpoint
 * wants the complete ordered id array the UI holds, which a conversation does
 * not have.
 */
export const packagesCoverage = defineCoverage('packages', {
  // ---- reads -------------------------------------------------------------
  // Read through the catalog port, alongside services and membership plans. A
  // package is only worth seeing NEXT TO the single-visit price it competes
  // with, so a packages-only list tool would not have closed the gap.
  'GET /packages': { exposed: 'packages_listSellables' },
  // The list read already carries the service-joined items, so the detail
  // route adds nothing Claire would quote.
  'GET /packages/:id': { undecided: 'ENG-CLAIRE-PACKAGES' },

  // ---- writes ------------------------------------------------------------
  'POST /packages': {
    notExposed:
      'Creates a package AND provisions a Stripe deposit payment link for it. That is a live, chargeable customer-facing URL, not a draft row, so it is not something to mint from a chat turn.',
  },
  'PUT /packages/:id': {
    notExposed:
      'Edits a package that may already be on sale, re-syncing its Stripe deposit link. Changing the price or contents of a bundle customers are mid-way through is a commercial decision with money attached.',
  },
  'DELETE /packages/:id': {
    notExposed:
      'Deletes the package and deactivates its Stripe payment link, breaking any URL already shared with customers. Reversible only by rebuilding it and reissuing a new link.',
  },
  'POST /packages/:id/items': {
    notExposed:
      'Adds a service line to a bundle, changing what a buyer receives for the price already published. It belongs to the package builder screen where the owner sees the whole bundle at once.',
  },
  'PUT /packages/:id/items/:itemId': {
    notExposed:
      'Edits one line of a bundle — quantity or the service it points at — with the same effect on what a customer has already paid for.',
  },
  'DELETE /packages/:id/items/:itemId': {
    notExposed:
      'Removes a service from the bundle, silently reducing what buyers are entitled to redeem. Not something to do without seeing the whole package.',
  },
  'POST /packages/:id/items/reorder': {
    notExposed:
      'Pure presentation ordering, and it takes the complete ordered id array that the drag-and-drop UI holds. Claire has no view to drag and nothing to gain from the result.',
  },
});
