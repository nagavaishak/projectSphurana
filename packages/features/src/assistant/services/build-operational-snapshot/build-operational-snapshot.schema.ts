import { z } from 'zod';

/**
 * Input shape for `buildOperationalSnapshot`.
 *
 * The service is org-scoped (snapshot rows are written `(orgId, null)` —
 * org-wide, visible to every user in the org). `now` is injectable so
 * tests and re-runs can pin a deterministic clock; production callers
 * (the nightly cron) leave it `undefined` so it defaults to `new Date()`.
 */
export const buildOperationalSnapshotSchema = z.object({
  organizationId: z.string().min(1),
  now: z.date().optional(),
});

export type BuildOperationalSnapshotInput = z.infer<
  typeof buildOperationalSnapshotSchema
>;

/**
 * Output of `buildOperationalSnapshot`.
 *
 * `knowledgeEntryId` is the inserted row id (or null when the snapshot was
 * skipped — e.g. embedding generation failed and the cron should keep going
 * on the next org). `skipReason` distinguishes empty-state orgs from real
 * skips.
 */
export interface BuildOperationalSnapshotOutput {
  knowledgeEntryId: string | null;
  skipReason?: 'embedding_failed' | 'insert_failed';
}
