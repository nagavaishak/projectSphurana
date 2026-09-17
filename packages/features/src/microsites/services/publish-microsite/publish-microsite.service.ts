/**
 * Publish = snapshot the draft into a revision, then point
 * `microsite.publishedRevisionId` at it.
 *
 * The public is served ONLY from a revision snapshot, never from
 * `microsite_page` — which is what makes an agent mid-edit invisible to
 * customers, and what makes undo a pointer move rather than a replay.
 *
 * Both writes happen in ONE transaction. Split them and a crash in between
 * leaves either a published site pointing at a revision that does not exist
 * (a hard 500 on a live customer domain) or an orphan revision that quietly
 * accumulates. `publishedRevisionId` is deliberately not a foreign key — see
 * the schema comment — so nothing but this transaction protects that pointer.
 */

import { microsite } from '@borradh-workspace/database';
import type { Database } from '@borradh-workspace/database';
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
import { syncMicrositeMetaDomains } from '../../domain-verification/meta-verification/index.js';
import { createRevisionImpl } from '../create-revision/index.js';
import { bustMicrositeHostCacheForMicrosite } from '../microsite-host-cache/index.js';
import { loadOwnedMicrosite } from '../shared/index.js';
import {
  type PublishMicrositeInput,
  publishMicrositeSchema,
} from './publish-microsite.schema.js';

export interface PublishMicrositeOutput {
  micrositeId: string;
  /** The revision the public is now served. Also the undo target for the NEXT publish. */
  publishedRevisionId: string;
  /** The revision that was live before this call, or null on a first publish. */
  previousRevisionId: string | null;
  status: 'published';
  pageCount: number;
}

/** Carries a FeatureError out of the transaction callback so it can roll back. */
class PublishAbort extends Error {
  constructor(readonly featureError: FeatureError) {
    super(featureError.message);
  }
}

const publishMicrositeImpl = async (
  db: DbConnection,
  input: PublishMicrositeInput
): Promise<Result<PublishMicrositeOutput>> => {
  const parsed = publishMicrositeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { micrositeId, organizationId, label, createdBy } = parsed.data;

  try {
    const result = await (db as Database).transaction(async (tx) => {
      // Read the outgoing pointer INSIDE the transaction: it is the undo target
      // this publish creates, and reading it after the update would return the
      // new one.
      const owned = await loadOwnedMicrosite(tx, micrositeId, organizationId);
      if (!owned.success) throw new PublishAbort(owned.error);
      const previousRevisionId = owned.data.publishedRevisionId;

      // `createRevisionImpl` re-checks org ownership inside the transaction, so
      // publish inherits the same WHERE-clause boundary as every other service
      // here rather than trusting a check made before the tx opened.
      const revision = await createRevisionImpl(tx, {
        micrositeId,
        organizationId,
        createdBy,
        label,
      });
      if (!revision.success) throw new PublishAbort(revision.error);

      const [updated] = await tx
        .update(microsite)
        .set({ publishedRevisionId: revision.data.id, status: 'published' })
        .where(
          and(
            eq(microsite.id, micrositeId),
            eq(microsite.organizationId, organizationId)
          )
        )
        .returning({
          id: microsite.id,
          publishedRevisionId: microsite.publishedRevisionId,
        });

      if (!updated) {
        // Unreachable while the revision insert succeeded, but an UPDATE that
        // matched nothing must never be reported as a publish.
        throw new PublishAbort(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Microsite not found')
        );
      }

      return {
        publishedRevisionId: revision.data.id,
        previousRevisionId,
        pageCount: revision.data.pages.length,
      };
    });

    // Plan §11 — publish is one of the two Meta domain-verification triggers.
    // The tag Meta crawls lives in the HTML we just regenerated, so this is
    // the moment to make sure every live custom host is claimed and carries a
    // token. Not awaited: it is a network round-trip to Meta, it repairs
    // itself on the next publish or the next activation, and a publish must
    // never fail — or even get slower — because Meta is unavailable. The
    // helper swallows its own failures, so the `catch` here is belt and
    // braces, not flow control.
    void syncMicrositeMetaDomains(db, { micrositeId, organizationId }).catch(
      () => undefined
    );

    // The cached host resolution carries `status`, so without this a site that
    // has just gone live keeps resolving as a draft for the TTL — the tenant
    // presses Publish and their site stays unavailable with no error anywhere.
    const site = await db.query.microsite.findFirst({
      where: eq(microsite.id, micrositeId),
      columns: { slug: true },
    });
    if (site) {
      await bustMicrositeHostCacheForMicrosite(db, {
        micrositeId,
        slug: site.slug,
      });
    }

    return ok({
      micrositeId,
      publishedRevisionId: result.publishedRevisionId,
      previousRevisionId: result.previousRevisionId,
      status: 'published' as const,
      pageCount: result.pageCount,
    });
  } catch (error) {
    if (error instanceof PublishAbort) return err(error.featureError);

    logError('microsites.publishMicrosite', error, {
      feature: 'microsites',
      extra: { micrositeId, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to publish microsite')
    );
  }
};

export const publishMicrosite = (
  db: DbConnection,
  input: PublishMicrositeInput
) =>
  trackedResult(
    'microsites.publishMicrosite',
    () => publishMicrositeImpl(db, input),
    {
      properties: {
        micrositeId: input.micrositeId,
        organizationId: input.organizationId,
      },
    }
  );

export type PublishMicrositeResult = Awaited<
  ReturnType<typeof publishMicrosite>
>;
