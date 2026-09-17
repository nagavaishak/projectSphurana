/**
 * Snapshot the working draft into an immutable `microsite_revision`.
 *
 * This is the primitive under BOTH publishing and undo (plan §4): every
 * mutating agent turn writes exactly one revision, publishing points
 * `microsite.publishedRevisionId` at one, and undo re-points at N-1. It is
 * exported on its own because the agent loop needs it per-turn, without
 * publishing.
 *
 * The snapshot is SANITIZED on the way in. A block that no longer parses is
 * dropped here rather than at render time, so a revision — the thing the public
 * is eventually served — can never contain a shape the renderer cannot draw.
 * That makes the drop happen once, in a place a human can see in the logs, and
 * keeps the published read path free of surprises.
 */

import {
  microsite,
  micrositePage,
  micrositeRevision,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import type {
  MicrositePage,
  MicrositeTheme,
} from '@borradh-workspace/web-shared';
import { and, asc, eq } from 'drizzle-orm';
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
  sanitizePage,
  sanitizeTheme,
} from '../shared/index.js';
import {
  type CreateRevisionInput,
  createRevisionSchema,
} from './create-revision.schema.js';

export interface MicrositeRevisionSummary {
  id: string;
  micrositeId: string;
  organizationId: string;
  label: string | null;
  createdBy: 'agent' | 'user' | 'system';
  promptId: string | null;
  createdAt: Date;
  pages: MicrositePage[];
  theme: MicrositeTheme;
}

/**
 * The transaction-safe body. `publishMicrosite` calls this directly inside its
 * own transaction so the snapshot and the pointer move commit together —
 * calling the tracked wrapper there would nest a second tracked span and, worse,
 * let the two halves commit separately.
 */
export const createRevisionImpl = async (
  db: DbConnection,
  input: CreateRevisionInput
): Promise<Result<MicrositeRevisionSummary>> => {
  const parsed = createRevisionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { micrositeId, organizationId, createdBy, label, promptId } =
    parsed.data;

  const owned = await loadOwnedMicrosite(db, micrositeId, organizationId);
  if (!owned.success) return err(owned.error);

  const ctx = { micrositeId, organizationId, source: 'draft' };

  const rows = await db.query.micrositePage.findMany({
    where: and(
      eq(micrositePage.micrositeId, micrositeId),
      eq(micrositePage.organizationId, organizationId)
    ),
    orderBy: [asc(micrositePage.order), asc(micrositePage.path)],
  });

  const pages = rows.map((row) => sanitizePage(row, ctx));
  const theme = sanitizeTheme(owned.data.theme, ctx);

  try {
    const [revision] = await db
      .insert(micrositeRevision)
      .values({
        micrositeId,
        organizationId,
        label: label ?? null,
        pages,
        theme,
        createdBy,
        promptId: promptId ?? null,
      })
      .returning();

    // The draft now corresponds to this snapshot. Undo reads this pointer to
    // know where N-1 is, and the Publish button counts the revisions between
    // it and `publishedRevisionId`. Leaving it stale would make an undo skip a
    // turn, so it moves with every revision — including the one `publish`
    // writes, which is why this is here and not in the callers.
    //
    // Callers that need the snapshot and the pointer to land together pass a
    // transaction (`publishMicrosite` and `restoreRevision` both do).
    await db
      .update(microsite)
      .set({ draftRevisionId: revision.id })
      .where(
        and(
          eq(microsite.id, micrositeId),
          eq(microsite.organizationId, organizationId)
        )
      );

    return ok({
      id: revision.id,
      micrositeId: revision.micrositeId,
      organizationId: revision.organizationId,
      label: revision.label,
      createdBy: revision.createdBy,
      promptId: revision.promptId,
      createdAt: revision.createdAt,
      pages,
      theme,
    });
  } catch (error) {
    logError('microsites.createRevision', error, {
      feature: 'microsites',
      extra: { micrositeId, organizationId, createdBy },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create revision')
    );
  }
};

export const createRevision = (db: DbConnection, input: CreateRevisionInput) =>
  trackedResult(
    'microsites.createRevision',
    () => createRevisionImpl(db, input),
    {
      properties: {
        micrositeId: input.micrositeId,
        organizationId: input.organizationId,
        createdBy: input.createdBy,
      },
      internalErrorsOnly: true,
    }
  );

export type CreateRevisionResult = Awaited<ReturnType<typeof createRevision>>;
