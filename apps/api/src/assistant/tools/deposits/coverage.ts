import { defineCoverage } from '../coverage.types.js';

/**
 * DEPOSITS — 6 endpoints, 0 tools. Pre-payment taken against an appointment to
 * make no-shows cost something, governed by `org.depositEnabled`.
 *
 * This is a read gap with a visible seam. `appointments_bookAppointment`
 * already accepts a flag whose only job is to tell the operator "the customer
 * will be sent a deposit payment link" — Claire announces the deposit and then
 * cannot see whether it was ever paid. So when the owner asks "did they pay?",
 * or "why is this booking still pending?", she is guessing. `GET
 * /deposits/appointment/:appointmentId` is one endpoint and closes that loop.
 *
 * The writes divide cleanly: creating and cancelling a deposit REQUEST moves no
 * money and is plausibly Claire's, so they are parked for a decision. The
 * refund moves real money out and is not.
 */
export const depositsCoverage = defineCoverage('deposits', {
  // ---- reads -------------------------------------------------------------
  'GET /deposits': { undecided: 'ENG-CLAIRE-DEPOSITS-READ' },
  'GET /deposits/:id': { undecided: 'ENG-CLAIRE-DEPOSITS-READ' },
  // The highest-value single endpoint here — it is the question the booking
  // tools raise and cannot answer.
  'GET /deposits/appointment/:appointmentId': {
    undecided: 'ENG-CLAIRE-DEPOSITS-READ',
  },

  // ---- writes ------------------------------------------------------------
  // A deposit request is an ASK, not a charge: it generates a payment link the
  // customer chooses to pay. Cancelling one withdraws an unpaid ask. Both are
  // reversible and would want `confirm: true` if exposed, since the customer
  // sees the result either way.
  'POST /deposits': { undecided: 'ENG-CLAIRE-DEPOSITS-WRITE' },
  'POST /deposits/:id/cancel': { undecided: 'ENG-CLAIRE-DEPOSITS-WRITE' },

  'POST /deposits/:id/refund': {
    notExposed:
      'Sends money back to a customer through the payment provider. It is irreversible from our side, it lands on the org’s Stripe balance and it is usually the outcome of a dispute the owner is negotiating in words Claire cannot see. Refunds stay a deliberate human act at the till.',
  },
});
