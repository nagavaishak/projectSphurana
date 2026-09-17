/**
 * Restore a revision into the working draft — the one primitive behind BOTH
 * undo and redo (contract §1).
 *
 * The draft is the `microsite_page` rows, not a pointer, because the renderer,
 * the inspector and manual edits all read and write those rows. So "go back one
 * turn" cannot be a pointer move: it is a rewrite of the page set from the
 * snapshot, plus `microsite.draftRevisionId` moved to say which snapshot the
 * draft now corresponds to.
 *
 * Nothing is deleted and no revision is rewritten — the revision list IS the
 * undo/redo stack, so redo is this same call with a later id.
 *
 * THREE things that are load-bearing:
 *
 *   ATOMIC — delete-then-insert of the whole page set in ONE transaction. A
 *            half-restored draft that someone then publishes is a broken live
 *            site; there is no "partially restored" state worth having.
 *   IDS    — the snapshot's page ids are reused verbatim. That makes a repeat
 *            restore of the same revision a no-op rather than a fresh set of
 *            rows, and keeps any id the editor is holding (selected block's
 *            page, an open inspector) valid across an undo.
 *   THEME  — restored too. The contract sentence only mentions the page rows,
 *            but the snapshot carries the theme and `update_theme` is a
 *            mutating turn like any other. Leaving `microsite.theme` alone
 *            would make undo silently skip theme turns, and would leave the
 *            draft preview disagreeing with what publishing the restored
 *            revision would serve.
 *
 * The snapshot is sanitized on the way out (../shared/document.ts): a revision
 * can predate a block-schema change, and jsonb round-trips anything. An invalid
 * block is dropped and logged rather than thrown — a restore that fails because
 * of one stale block would strand the tenant on the bad draft they are trying
 * to undo.
 */

import {
  type Database,
  microsite,
  micrositePage,
  micrositeRevision,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  loadOwnedMicrosite,
  sanitizeSnapshotPages,
  sanitizeTheme,
} from '../shared/index.js';
import {
  type RestoreRevisionInput,
  restoreRevisionSchema,
} from './restore-revision.schema.js';

export interface RestoreRevisionOutput {
  micrositeId: string;
  /** Now both the restored revision and `microsite.draftRevisionId`. */
  draftRevisionId: string;
  /** The revision the draft corresponded to before this call. */
  previousDraftRevisionId: string | null;
  /** Pages written. Fewer than the snapshot held if one was unparseable. */
  pageCount: number;
}

/** Carries a FeatureError out of the transaction callback so it can roll back. */
class RestoreAbort extends Error {
  constructor(readonly featureError: FeatureError) {
    super(featureError.message);
  }
}

const restoreRevisionImpl = async (
  db: DbConnection,
  input: RestoreRevisionInput
): Promise<Result<RestoreRevisionOutput>> => {
  const parsed = restoreRevisionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { micrositeId, organizationId, revisionId } = parsed.data;

  try {
    const result = await (db as Database).transaction(async (tx) => {
      const owned = await loadOwnedMicrosite(tx, micrositeId, organizationId);
      if (!owned.success) throw new RestoreAbort(owned.error);
      const previousDraftRevisionId = owned.data.draftRevisionId;

      // Org AND microsite are both in the WHERE clause: a revision id from
      // another tenant, or from another site, must not resolve here — and a
      // wrong-org id returns NOT_FOUND rather than FORBIDDEN, because
      // FORBIDDEN would confirm the id exists.
      const revision = await tx.query.micrositeRevision.findFirst({
        where: and(
          eq(micrositeRevision.id, revisionId),
          eq(micrositeRevision.micrositeId, micrositeId),
          eq(micrositeRevision.organizationId, organizationId)
        ),
        columns: { id: true, pages: true, theme: true },
      });

      if (!revision) {
        throw new RestoreAbort(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Revision not found')
        );
      }

      const ctx = { micrositeId, organizationId, source: revision.id };
      const pages = sanitizeSnapshotPages(revision.pages, ctx);
      const theme = sanitizeTheme(revision.theme, ctx);

      // Delete-then-insert rather than a per-path diff: the snapshot is the
      // whole document, so a page ADDED after this revision has to disappear,
      // and a diff would have to reproduce that deletion anyway.
      await tx
        .delete(micrositePage)
        .where(
          and(
            eq(micrositePage.micrositeId, micrositeId),
            eq(micrositePage.organizationId, organizationId)
          )
        );

      if (pages.length > 0) {
        await tx.insert(micrositePage).values(
          pages.map((page) => ({
            id: page.id,
            micrositeId,
            organizationId,
            path: page.path,
            title: page.title,
            seo: page.seo,
            blocks: page.blocks,
            order: page.order,
            isSystem: page.isSystem,
          }))
        );
      }

      await tx
        .update(microsite)
        .set({ draftRevisionId: revision.id, theme })
        .where(
          and(
            eq(microsite.id, micrositeId),
            eq(microsite.organizationId, organizationId)
          )
        );

      return {
        draftRevisionId: revision.id,
        previousDraftRevisionId,
        pageCount: pages.length,
      };
    });

    return ok({ micrositeId, ...result });
  } catch (error) {
    if (error instanceof RestoreAbort) return err(error.featureError);

    logError('microsites.restoreRevision', error, {
      feature: 'microsites',
      extra: { micrositeId, organizationId, revisionId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to restore revision')
    );
  }
};

export const restoreRevision = (
  db: DbConnection,
  input: RestoreRevisionInput
) =>
  trackedResult(
    'microsites.restoreRevision',
    () => restoreRevisionImpl(db, input),
    {
      properties: {
        micrositeId: input.micrositeId,
        organizationId: input.organizationId,
        revisionId: input.revisionId,
      },
    }
  );

export type RestoreRevisionResult = Awaited<ReturnType<typeof restoreRevision>>;
