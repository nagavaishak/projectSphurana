import { defineCoverage } from '../coverage.types.js';

/**
 * C — 2 endpoints, 0 tools. The campaign short-link controller, mounted at the
 * one-character prefix `c` so that unsubscribe URLs stay short enough to sit in
 * an SMS without eating the message. The directory is `_c` for readability; the
 * gate keys off the `area` string.
 *
 * Both routes are the UNSUBSCRIBE surface, and they are the most legally
 * load-bearing pair on the public API: they are the mechanism by which a
 * recipient exercises a right we are obliged to honour, and their availability
 * is what keeps the sending domain and the SMS number deliverable.
 *
 * They are addressed by a signed per-recipient token embedded in the link, so
 * they act for ONE customer — the same shape as the public manage-booking
 * routes, and closed for the same reason. Withholding them costs Claire
 * nothing: suppression state is a property of the audience she already reads
 * when previewing a campaign, and nobody has ever asked their business's
 * assistant to unsubscribe a customer on their behalf.
 */
export const cCoverage = defineCoverage('c', {
  'GET /c/u/:token': {
    notExposed:
      'Renders the unsubscribe confirmation page a recipient lands on from an email or SMS link. It is HTML served to a member of the public, addressed by their own signed token.',
  },
  'POST /c/u/:token': {
    notExposed:
      'Records the opt-out, including the one-click path mail providers require. Suppressing someone is the recipient’s own act of consent withdrawal; an agent doing it on their behalf would falsify a compliance record, and doing it wrongly silently removes a real customer from every future campaign.',
  },
});
