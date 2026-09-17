import {
  type Graphic,
  graphic,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  deleteObject,
  extractKeyFromCdnUrl,
  parseS3Url,
} from '@borradh-workspace/storage';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  findAdsUsingCreative,
  ok,
} from '../../../shared/index.js';
import {
  type DeleteGraphicInput,
  deleteGraphicSchema,
} from './delete-graphic.schema.js';

/**
 * Clean up S3 assets associated with a deleted graphic.
 * Fire-and-forget — failures are logged but don't break the delete operation.
 */
async function cleanupGraphicS3Assets(deletedGraphic: Graphic): Promise<void> {
  const urls: string[] = [];

  // Collect rendered output URLs
  if (deletedGraphic.outputs) {
    for (const output of deletedGraphic.outputs) {
      if (output.url) urls.push(output.url);
    }
  }

  // Note: `graphic.slides` is a legacy carryover jsonb (id/order/objectKey only)
  // and does not carry real thumbnail URLs in practice, so we no longer attempt
  // to clean those up here. See docs/implementations/canva-deletion-followup.md.

  for (const url of urls) {
    // Try S3 URL first, then CDN URL
    const s3Info = parseS3Url(url);
    if (s3Info) {
      try {
        await deleteObject({ bucket: s3Info.bucket, key: s3Info.key });
      } catch (error) {
        logError('graphics.deleteGraphic.s3Cleanup', error, {
          feature: 'graphics',
          extra: { url, graphicId: deletedGraphic.id },
        });
      }
    } else {
      const key = extractKeyFromCdnUrl(url);
      if (key) {
        try {
          await deleteObject({ key });
        } catch (error) {
          logError('graphics.deleteGraphic.s3Cleanup', error, {
            feature: 'graphics',
            extra: { url, graphicId: deletedGraphic.id },
          });
        }
      }
    }
  }
}

const deleteGraphicImpl = async (
  db: DbConnection,
  input: DeleteGraphicInput
): Promise<Result<{ success: boolean }>> => {
  const parsed = deleteGraphicSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input'));
  }

  const { id, organizationId } = parsed.data;

  try {
    const existing = await withOrgScope(
      (tx) =>
        tx.query.graphic.findFirst({
          where: and(
            eq(graphic.id, id),
            eq(graphic.organizationId, organizationId)
          ),
        }),
      { db }
    );

    if (!existing) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Graphic not found'));
    }

    // This delete destroys the S3 objects too, so an ad still pointing at the
    // graphic would be left with a dangling reference and unrecoverable media.
    const inUse = await findAdsUsingCreative(db, {
      creativeId: id,
      organizationId,
    });
    if (inUse) return err(inUse);

    await withOrgScope(
      (tx) =>
        tx
          .delete(graphic)
          .where(
            and(eq(graphic.id, id), eq(graphic.organizationId, organizationId))
          ),
      { db }
    );

    // Fire-and-forget S3 cleanup
    cleanupGraphicS3Assets(existing).catch((error) =>
      logError('graphics.deleteGraphic.s3Cleanup', error, {
        feature: 'graphics',
        extra: { graphicId: id },
      })
    );

    return ok({ success: true });
  } catch (error) {
    logError('graphics.deleteGraphic', error, {
      feature: 'graphics',
      extra: { id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to delete graphic')
    );
  }
};

export const deleteGraphic = (db: DbConnection, input: DeleteGraphicInput) =>
  trackedResult('graphics.deleteGraphic', () => deleteGraphicImpl(db, input), {
    properties: { id: input.id },
  });

export type DeleteGraphicResult = Awaited<ReturnType<typeof deleteGraphic>>;
