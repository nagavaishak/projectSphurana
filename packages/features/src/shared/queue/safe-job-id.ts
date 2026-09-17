/**
 * Build a BullMQ-safe job id from arbitrary parts.
 *
 * BullMQ uses `:` as its internal Redis key separator, so a job id that
 * contains a colon silently breaks `queue.getJob(id)` lookups and job
 * removal (the known "jobIds can't contain `:`" gotcha). Producers across
 * the codebase interpolate external-ish identifiers — `organizationId`,
 * `metaAdsPageId`, asset URLs — directly into job ids, any of which could
 * carry a colon or whitespace. Routing every producer through this helper
 * guarantees the id is safe regardless of what the source value contains.
 *
 * Nullish and empty parts are dropped so callers can pass optional segments
 * without producing `foo--bar` or trailing dashes.
 *
 * @example
 *   safeJobId('voice-ingest', orgId, pageId)        // "voice-ingest-<org>-<page>"
 *   safeJobId('dlq', queueName, jobId, Date.now())  // unique DLQ id
 */
const UNSAFE_JOB_ID_CHARS = /[:\s/\\]+/g;

export function safeJobId(
  ...parts: Array<string | number | null | undefined>
): string {
  return parts
    .filter(
      (part): part is string | number =>
        part !== null && part !== undefined && part !== ''
    )
    .map((part) => String(part).replace(UNSAFE_JOB_ID_CHARS, '-'))
    .join('-');
}
