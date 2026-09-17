import { defineCoverage } from '../coverage.types.js';

/**
 * PAYMENTS — 4 endpoints. Deposit and checkout LINKS (Stripe hosted payment
 * pages), which is not what the area name suggests: the tenders taken at the
 * till live in `sale_payment` and are read through the `sales` area. These are
 * a genuinely SEPARATE money channel, and one that `GET /sales/daily-summary`
 * does not see.
 *
 * That is why `GET /payments` is exposed rather than parked. Answering "what
 * did we take today?" from the POS summary alone omits every deposit the
 * business collected, and an under-reported takings figure that looks
 * authoritative is worse than no figure — so `sales_getTakings` reads both
 * channels and reports them separately. It also reports this channel as
 * UNREAD when it cannot prove completeness, which is often: this route has no
 * date filter and sorts by `createdAt` while what matters is `paidAt`.
 *
 * The writes are where this area diverges from a normal CRUD surface, and it
 * is worth being precise about why. A payment row is not a note about money;
 * it is the record that money moved. Recording one that did not happen leaves
 * a till that will not reconcile at close, and the pending-tender defect that
 * ate a sale's full balance is a reminder that this table's invariants are
 * subtle. The refund is worse: it moves real money back out through Stripe and
 * is not undone by deleting the row.
 */
export const paymentsCoverage = defineCoverage('payments', {
  // ---- reads -------------------------------------------------------------
  // Read as the deposits half of a takings total. See the note above on why
  // leaving it out is the under-report, and why the tool treats an unprovable
  // read as missing rather than as zero.
  'GET /payments': { exposed: 'sales_getTakings' },
  // Parked: a single deposit's detail is a client-level record (customer name,
  // email, Stripe ids) and wants its own decision about what Claire may repeat.
  'GET /payments/:id': { undecided: 'ENG-CLAIRE-SALES' },

  // ---- writes ------------------------------------------------------------
  'POST /payments': {
    notExposed:
      'Records a tender against a sale. It is the assertion that money changed hands, so a wrong or duplicated row leaves the till failing to reconcile at close — and a pending non-cash tender has already been seen consuming a sale’s whole balance. This belongs to the person standing at the till.',
  },
  'POST /payments/:id/refund': {
    notExposed:
      'Moves real money back out through Stripe. Irreversible from our side, settled against the customer’s card by the provider, and never something that should be one sentence away in a chat window.',
  },
});
