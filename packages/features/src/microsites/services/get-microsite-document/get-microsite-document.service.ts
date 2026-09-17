/**
 * Read a microsite as a `MicrositeDocument` — the shape the renderer and the
 * agent both take.
 *
 * TWO SOURCES, ON PURPOSE.
 *   draft     → the `microsite_page` rows. What the editor and the signed
 *               preview show; changes the moment a tool writes.
 *   published → the snapshot inside the revision named by
 *               `microsite.publishedRevisionId`. Never the page rows — that is
 *               what keeps an agent mid-edit invisible to customers.
 *
 * A microsite with no `publishedRevisionId` is NOT_FOUND in `published` mode.
 * There is no "fall back to the draft": falling back would publish an unfinished
 * site the moment someone hit the public URL, which is precisely the failure the
 * two-source split exists to prevent.
 *
 * All jsonb is re-validated on the way out — see ../shared/document.ts for what
 * happens to a block that no longer parses (it is dropped and logged).
 */

import { micrositePage, micrositeRevision } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import type { MicrositeDocument } from '@borradh-workspace/web-shared';
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
  sanitizeSnapshotPages,
  sanitizeTheme,
} from '../shared/index.js';
import {
  type GetMicrositeDocumentInput,
  getMicrositeDocumentSchema,
} from './get-microsite-document.schema.js';

export interface GetMicrositeDocumentOutput extends MicrositeDocument {
  micrositeId: string;
  slug: string;
  mode: 'draft' | 'published';
  /** Null in `draft` mode. */
  revisionId: string | null;
}

const getMicrositeDocumentImpl = async (
  db: DbConnection,
  input: GetMicrositeDocumentInput
): Promise<Result<GetMicrositeDocumentOutput>> => {
  const parsed = getMicrositeDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { micrositeId, organizationId, mode } = parsed.data;

  const owned = await loadOwnedMicrosite(db, micrositeId, organizationId);
  if (!owned.success) return err(owned.error);
  const site = owned.data;

  if (mode === 'published') {
    if (!site.publishedRevisionId) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'This website has not been published yet'
        )
      );
    }

    const revision = await db.query.micrositeRevision.findFirst({
      where: and(
        eq(micrositeRevision.id, site.publishedRevisionId),
        eq(micrositeRevision.micrositeId, micrositeId),
        eq(micrositeRevision.organizationId, organizationId)
      ),
      columns: { id: true, pages: true, theme: true },
    });

    if (!revision) {
      // `publishedRevisionId` is not a foreign key (schema comment: it would
      // cycle), so a deleted revision leaves a dangling pointer. Report it as
      // unpublished rather than 500 — the tenant can republish.
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'The published version of this website is no longer available'
        )
      );
    }

    const ctx = { micrositeId, organizationId, source: revision.id };
    return ok({
      micrositeId,
      slug: site.slug,
      mode,
      revisionId: revision.id,
      theme: sanitizeTheme(revision.theme, ctx),
      pages: sanitizeSnapshotPages(revision.pages, ctx),
    });
  }

  const ctx = { micrositeId, organizationId, source: 'draft' };
  const rows = await db.query.micrositePage.findMany({
    where: and(
      eq(micrositePage.micrositeId, micrositeId),
      eq(micrositePage.organizationId, organizationId)
    ),
    orderBy: [asc(micrositePage.order), asc(micrositePage.path)],
  });

  return ok({
    micrositeId,
    slug: site.slug,
    mode,
    revisionId: null,
    theme: sanitizeTheme(site.theme, ctx),
    pages: rows.map((row) => sanitizePage(row, ctx)),
  });
};

export const getMicrositeDocument = (
  db: DbConnection,
  input: GetMicrositeDocumentInput
) =>
  trackedResult(
    'microsites.getMicrositeDocument',
    () => getMicrositeDocumentImpl(db, input),
    {
      properties: {
        micrositeId: input.micrositeId,
        organizationId: input.organizationId,
        mode: input.mode ?? 'draft',
      },
      internalErrorsOnly: true,
    }
  );

export type GetMicrositeDocumentResult = Awaited<
  ReturnType<typeof getMicrositeDocument>
>;
