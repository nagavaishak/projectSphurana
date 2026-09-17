import {
  type GraphicOutput,
  graphic,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import type {
  getOrgAssetsBucket as GetOrgAssetsBucketFn,
  getPrivateCdnUrl as GetPrivateCdnUrlFn,
  isCdnEnabled as IsCdnEnabledFn,
} from '@borradh-workspace/storage';
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
  type ConfirmGraphicOutputInput,
  confirmGraphicOutputSchema,
} from './confirm-graphic-output.schema.js';

export interface ConfirmGraphicOutputStorageDeps {
  getOrgAssetsBucket: typeof GetOrgAssetsBucketFn;
  getPrivateCdnUrl: typeof GetPrivateCdnUrlFn;
  isCdnEnabled: typeof IsCdnEnabledFn;
}

const confirmGraphicOutputImpl = async (
  db: DbConnection,
  storage: ConfirmGraphicOutputStorageDeps,
  input: ConfirmGraphicOutputInput
): Promise<Result<{ output: GraphicOutput }>> => {
  const parsed = confirmGraphicOutputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    id,
    organizationId,
    objectKey,
    slideId,
    slideOrder,
    format,
    width,
    height,
  } = parsed.data;

  // Scope the object key to this graphic so callers can't confirm an arbitrary
  // key they got elsewhere. Matches createGraphicOutputUploadUrl's convention,
  // which follows org-assets' existing `{organizationId}/...` prefix.
  const expectedPrefix = `${organizationId}/graphics/${id}/`;
  if (!objectKey.startsWith(expectedPrefix)) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Object key does not belong to this graphic'
      )
    );
  }

  const existing = await withOrgScope(
    (tx) =>
      tx.query.graphic.findFirst({
        where: and(
          eq(graphic.id, id),
          eq(graphic.organizationId, organizationId)
        ),
        columns: { id: true, outputs: true },
      }),
    { db }
  );

  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Graphic not found'));
  }

  // Note: slide-existence check intentionally dropped. Post-Fabric, the canonical
  // slide list lives in `fabricScene` (or, before any edit, the upstream
  // imageTemplate). The legacy `graphic.slides` shim was always written as `[]`
  // on insert and never repopulated, so any check against it would have always
  // returned NOT_FOUND. The caller's `slideId` is now trusted; downstream
  // consumers of `outputs[]` join on `slideId`, so a bogus value simply yields
  // an orphan output that nothing references.
  const currentOutputs = existing.outputs ?? [];

  if (currentOutputs.some((output) => output.objectKey === objectKey)) {
    return err(
      new FeatureError(
        ErrorCodes.ALREADY_EXISTS,
        'Output for this object key already recorded'
      )
    );
  }

  // Prefer the CDN URL when configured; fall back to an S3 virtual-hosted URL
  // (consumers will still need to sign it for private reads, but at least the
  // URL shape is valid and parseable).
  const url = storage.isCdnEnabled()
    ? storage.getPrivateCdnUrl(objectKey)
    : `https://${storage.getOrgAssetsBucket()}.s3.amazonaws.com/${objectKey}`;

  const output: GraphicOutput = {
    aspectRatioId: 'canvas',
    platform: 'web',
    width,
    height,
    url,
    format,
    slideId,
    slideOrder,
    objectKey,
    renderedBy: 'client',
    renderedAt: new Date().toISOString(),
  };

  try {
    const [updated] = await withOrgScope(
      (tx) =>
        tx
          .update(graphic)
          .set({ outputs: [...currentOutputs, output] })
          .where(
            and(eq(graphic.id, id), eq(graphic.organizationId, organizationId))
          )
          .returning({ outputs: graphic.outputs }),
      { db }
    );

    const persistedOutput = updated?.outputs?.find(
      (item) => item.objectKey === objectKey
    );

    return ok({ output: persistedOutput ?? output });
  } catch (error) {
    logError('graphics.confirmGraphicOutput', error, {
      feature: 'graphics',
      extra: { id, slideId, objectKey },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to record graphic output'
      )
    );
  }
};

export const confirmGraphicOutput = (
  db: DbConnection,
  storage: ConfirmGraphicOutputStorageDeps,
  input: ConfirmGraphicOutputInput
) =>
  trackedResult(
    'graphics.confirmGraphicOutput',
    () => confirmGraphicOutputImpl(db, storage, input),
    {
      properties: {
        graphicId: input.id,
        slideId: input.slideId,
        format: input.format,
      },
    }
  );

export type ConfirmGraphicOutputResult = Awaited<
  ReturnType<typeof confirmGraphicOutput>
>;
