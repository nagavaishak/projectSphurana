/**
 * Claire's offer preview card — the SECOND writer of `PUT /offers/:id`.
 *
 * The card is a sparse editor of a chat-owned draft: per Decision #14 only the
 * name, the validity date and the ONE numeric field matching the draft's
 * discount shape are editable inline (code, locations and redemption rules are
 * read-only summaries — owners change those by asking Claire). Both its writes
 * (Save draft, Publish) hand those edits to the same `buildUpdateOfferPayload`
 * the offer-form-dialog uses, so the two writers cannot encode a shared field
 * two different ways.
 *
 * The card is therefore a SURFACE of the one `offerForm`, owning that slice — it
 * is not a form of its own. It just reaches those fields through its own
 * controls, whose labels are the chat card's vocabulary rather than the dialog's
 * ("Offer name", not "Promotion Name"). They live here so the card and the
 * contract's per-surface fills read the same string, exactly as `form.labels`
 * does for the dialog.
 */
export const offerDraftLabels = {
  name: 'Offer name',
  offerPriceEuros: 'Offer price (€)',
  discountPercent: 'Discount (%)',
  validUntil: 'Valid until',
} as const;
