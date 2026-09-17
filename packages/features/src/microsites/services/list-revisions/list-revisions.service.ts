/**
 * Newest-first revision history for the editor sidebar, plus the two numbers
 * the chrome around it needs.
 *
 * The snapshots themselves are NOT returned. A revision holds the whole page
 * set, so a 20-row history would be megabytes of jsonb to render a list of
 * labels; `restoreRevision` is what loads one.
 *
 * `isPublished` / `isDraft` mark the two pointers (`microsite.publishedRevisionId`,
 * `microsite.draftRevisionId`) so the sidebar can draw "live" and "you are here"
 * without a second round trip — and so it never has to infer them from
 * position, which breaks the moment an older revision is restored.
 *
 * `changesSincePublish` is what the Publish button shows. It counts the
 * revisions in `(published, draft]` — created after the live one, up to and
 * including the one the draft currently corresponds to. Consequences worth
 * knowing:
 *   - straight after a publish the two pointers are equal, so it is 0;
 *   - after N agent turns it is N;
 *   - after an undo it is N-1, because the draft pointer moved back one;
 *   - if the draft is restored to the published revision or to something OLDER
 *     than it, it is 0 — the count is "unpublished work ahead of live", and
 *     there is a real edge here: a draft behind the live revision still differs
 *     from it, and the button will say nothing is pending. The alternative
 *     (an absolute distance) would say "3 changes" for a draft that is three
 *     turns BEHIND, which reads worse. Flagged rather than hidden.
 */

import { micrositeRevision } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, count, desc, eq, gt, lt, lte, or } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { loadOwnedMicrosite } from '../shared/index.js';
import {
  type ListRevisionsInput,
  listRevisionsSchema,
} from './list-revisions.schema.js';

export interface MicrositeRevisionListItem {
  id: string;
  label: string | null;
  createdBy: 'agent' | 'user' | 'system';
  promptId: string | null;
  createdAt: Date;
  /** This revision is what the public is served. */
  isPublished: boolean;
  /** The working draft currently corresponds to this revision. */
  isDraft: boolean;
}

export interface ListRevisionsOutput {
  items: MicrositeRevisionListItem[];
  /** Pass back as `cursor` for the next page; null when the history ends here. */
  nextCursor: string | null;
  publishedRevisionId: string | null;
  draftRevisionId: string | null;
  changesSincePublish: number;
}

const encodeCursor = (row: { id: string; createdAt: Date }) =>
  `${row.createdAt.toISOString()}|${row.id}`;

const decodeCursor = (
  cursor: string
): { createdAt: Date; id: string } | null => {
  const separator = cursor.indexOf('|');
  if (separator <= 0) return null;
  const createdAt = new Date(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
};

/** `createdAt` of a pointer, or null if the pointer is unset or dangling. */
const pointerCreatedAt = async (
  db: DbConnection,
  micrositeId: string,
  organizationId: string,
  revisionId: string | null
): Promise<Date | null> => {
  if (!revisionId) return null;
  const row = await db.query.micrositeRevision.findFirst({
    where: and(
      eq(micrositeRevision.id, revisionId),
      eq(micrositeRevision.micrositeId, micrositeId),
      eq(micrositeRevision.organizationId, organizationId)
    ),
    columns: { id: true, createdAt: true },
  });
  return row?.createdAt ?? null;
};

const listRevisionsImpl = async (
  db: DbConnection,
  input: ListRevisionsInput
): Promise<Result<ListRevisionsOutput>> => {
  const parsed = listRevisionsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { micrositeId, organizationId, limit, cursor } = parsed.data;

  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid cursor'));
  }

  const owned = await loadOwnedMicrosite(db, micrositeId, organizationId);
  if (!owned.success) return err(owned.error);
  const { publishedRevisionId, draftRevisionId } = owned.data;

  const scope = and(
    eq(micrositeRevision.micrositeId, micrositeId),
    eq(micrositeRevision.organizationId, organizationId)
  );

  // One extra row is the "is there another page" probe — cheaper and more
  // honest than a COUNT the caller never uses.
  const rows = await db.query.micrositeRevision.findMany({
    where: decoded
      ? and(
          scope,
          or(
            lt(micrositeRevision.createdAt, decoded.createdAt),
            and(
              eq(micrositeRevision.createdAt, decoded.createdAt),
              lt(micrositeRevision.id, decoded.id)
            )
          )
        )
      : scope,
    orderBy: [desc(micrositeRevision.createdAt), desc(micrositeRevision.id)],
    limit: limit + 1,
    columns: {
      id: true,
      label: true,
      createdBy: true,
      promptId: true,
      createdAt: true,
    },
  });

  const page = rows.slice(0, limit);
  const items: MicrositeRevisionListItem[] = page.map((row) => ({
    id: row.id,
    label: row.label,
    createdBy: row.createdBy,
    promptId: row.promptId,
    createdAt: row.createdAt,
    isPublished: row.id === publishedRevisionId,
    isDraft: row.id === draftRevisionId,
  }));

  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? encodeCursor(last) : null;

  return ok({
    items,
    nextCursor,
    publishedRevisionId,
    draftRevisionId,
    changesSincePublish: await countChangesSincePublish(db, {
      micrositeId,
      organizationId,
      publishedRevisionId,
      draftRevisionId,
    }),
  });
};

const countChangesSincePublish = async (
  db: DbConnection,
  input: {
    micrositeId: string;
    organizationId: string;
    publishedRevisionId: string | null;
    draftRevisionId: string | null;
  }
): Promise<number> => {
  const { micrositeId, organizationId, publishedRevisionId, draftRevisionId } =
    input;

  // Nothing snapshotted yet, or the draft IS what is live: no pending work.
  // The equality case is the common one — it holds from the instant a publish
  // commits — so it short-circuits before any query.
  if (!draftRevisionId) return 0;
  if (draftRevisionId === publishedRevisionId) return 0;

  const draftAt = await pointerCreatedAt(
    db,
    micrositeId,
    organizationId,
    draftRevisionId
  );
  // A dangling draft pointer (the revision was deleted) has no position to
  // count from. Report 0 rather than guessing; the count is UI chrome.
  if (!draftAt) return 0;

  const publishedAt = await pointerCreatedAt(
    db,
    micrositeId,
    organizationId,
    publishedRevisionId
  );

  // Draft restored to the published point or behind it — see the file header.
  if (publishedAt && draftAt <= publishedAt) return 0;

  const [row] = await db
    .select({ value: count() })
    .from(micrositeRevision)
    .where(
      and(
        eq(micrositeRevision.micrositeId, micrositeId),
        eq(micrositeRevision.organizationId, organizationId),
        lte(micrositeRevision.createdAt, draftAt),
        // Never published: every revision up to the draft is pending.
        ...(publishedAt ? [gt(micrositeRevision.createdAt, publishedAt)] : [])
      )
    );

  return row?.value ?? 0;
};

export const listRevisions = (db: DbConnection, input: ListRevisionsInput) =>
  trackedResult(
    'microsites.listRevisions',
    () => listRevisionsImpl(db, input),
    {
      properties: {
        micrositeId: input.micrositeId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

export type ListRevisionsResult = Awaited<ReturnType<typeof listRevisions>>;
