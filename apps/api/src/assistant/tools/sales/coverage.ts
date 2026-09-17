import { defineCoverage } from '../coverage.types.js';

/**
 * SALES — 14 endpoints, 0 tools. The point-of-sale checkout: a sale is opened,
 * items and a client are attached, tenders are recorded against it, and it is
 * then completed or voided. Eleven of the fourteen routes are steps in that one
 * state machine, and every one of them moves money or the record of money.
 *
 * The coverage decision splits cleanly on that. `GET /sales/daily-summary` is
 * now exposed through `sales_getTakings` — "what did we take today?" is the
 * revenue question owners actually ask, and it is answerable from one read that
 * moves nothing. The writes are not parked: a till transaction is driven by
 * whoever is standing at it, with the customer present and a card terminal in
 * hand, and Claire has neither the presence nor the tender to finish what she
 * would start. A half-built sale left open on the system is worse than no sale.
 */
export const salesCoverage = defineCoverage('sales', {
  // ---- reads -------------------------------------------------------------
  // The authoritative takings figure: computed over `completedAt` for completed
  // sales only, tender split already done, and — unlike `GET /sales` — NOT
  // paginated, so it cannot silently under-report a busy day.
  'GET /sales/daily-summary': { exposed: 'sales_getTakings' },
  // Still parked, on purpose. `GET /sales` filters on `createdAt` across ALL
  // statuses and caps at 200 rows a page, so summing it answers a subtly
  // different question to the summary; exposing both invites Claire to quote
  // whichever she happened to read. `GET /sales/:id` is a single-transaction
  // drill-down that needs its own thinking about client details on a receipt.
  'GET /sales': { undecided: 'ENG-CLAIRE-SALES' },
  'GET /sales/:id': { undecided: 'ENG-CLAIRE-SALES' },

  // ---- writes ------------------------------------------------------------
  'POST /sales': {
    notExposed:
      'Opens an empty till transaction that only means something once a human at the counter adds items and takes payment. Claire creating one produces an abandoned draft sale that a staff member has to find and void.',
  },
  'POST /sales/from-appointment': {
    notExposed:
      'Same checkout state machine, seeded from a booking. It is the first press of a checkout the front desk is about to run; starting it remotely puts an open sale on a terminal nobody is at.',
  },
  'POST /sales/:id/items': {
    notExposed:
      'Adds a priced line to a live transaction. The basket must match what the customer is physically taking away, which only the person serving them can attest to.',
  },
  'DELETE /sales/:id/items/:itemId': {
    notExposed:
      'Removes a priced line from a live transaction, changing the amount owed. Editing someone else’s open till mid-checkout is how a customer gets charged the wrong total.',
  },
  'PUT /sales/:id/tip': {
    notExposed:
      'Sets the tip on a sale, which flows to staff earnings. Only the person who was handed the tip knows the figure, and it is not Claire’s to attribute.',
  },
  'PUT /sales/:id/client': {
    notExposed:
      'Attaches a client to an in-progress transaction, binding purchase history to a person. Getting it wrong writes one customer’s spend onto another’s record.',
  },
  'POST /sales/:id/payments': {
    notExposed:
      'Records a tender against the balance. This is the money step: cash counted, card presented, gift card burnt down. An unsupervised assistant must not be able to claim a payment happened.',
  },
  'POST /sales/:id/payments/:paymentId/settle-card': {
    notExposed:
      'Settles a pending card tender against Stripe. It reconciles an external payment intent, and a wrongly settled tender leaves the books disagreeing with the processor.',
  },
  'POST /sales/:id/payments/:paymentId/cancel': {
    notExposed:
      'Voids a recorded tender and returns the balance owed. Reversing money that a customer believes they have paid is a human decision with a human accountable for it.',
  },
  'POST /sales/:id/complete': {
    notExposed:
      'Closes the sale, finalising revenue, stock depletion and any gift-card or membership burn-down. It is the irreversible commit of the whole transaction.',
  },
  'POST /sales/:id/void': {
    notExposed:
      'Voids a completed sale and unwinds its effects. Voids are the line item an accountant looks at hardest, so they stay a deliberate act by a named staff member.',
  },
  'POST /sales/:id/fulfilment/:status': {
    notExposed:
      'Moves a paid collection order between Ready and Collected. The staff member handing over the goods must attest to the physical handoff; Claire cannot observe it or truthfully complete the record.',
  },
});
