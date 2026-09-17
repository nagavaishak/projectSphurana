/**
 * Map Meta effective_status to our local ad status.
 *
 * Canonical mapping — all services must use this instead of inline copies.
 * Covers the full set of Meta effective statuses.
 *
 * NOTE: `draft` is deliberately NOT a possible output. In this codebase
 * `draft` means "never published — no `metaAdId`". Every caller here is
 * mapping a status that came back FROM Meta, so the ad demonstrably exists
 * on Meta and cannot be a draft. Mapping `IN_PROCESS` to `draft` (as this
 * did) made a live, spending ad render as "In draft" in the ads table, and
 * led Claire to tell owners "nothing is live until you launch it" about an
 * ad that was already delivering.
 */
export const mapMetaAdStatus = (
  metaStatus: string
): 'active' | 'paused' | 'pending' | 'rejected' | 'error' => {
  const statusMap: Record<
    string,
    'active' | 'paused' | 'pending' | 'rejected' | 'error'
  > = {
    ACTIVE: 'active',
    PAUSED: 'paused',
    PENDING_REVIEW: 'pending',
    DISAPPROVED: 'rejected',
    DELETED: 'error',
    ARCHIVED: 'paused',
    WITH_ISSUES: 'error',
    // Meta is still processing the ad (video transcoding, review queued).
    // It is published but not yet delivering — that is exactly `pending`
    // ("In review" in the UI), never `draft`.
    IN_PROCESS: 'pending',
    CAMPAIGN_PAUSED: 'paused',
    ADSET_PAUSED: 'paused',
  };
  return statusMap[metaStatus] || 'paused';
};
