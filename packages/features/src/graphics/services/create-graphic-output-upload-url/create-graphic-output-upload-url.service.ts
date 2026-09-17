import { randomUUID } from 'node:crypto';
import { graphic, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import type {
  getOrgAssetsBucket as GetOrgAssetsBucketFn,
  getPresignedUploadUrl as GetPresignedUploadUrlFn,
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
  type CreateGraphicOutputUploadUrlInput,
  type CreateGraphicOutputUploadUrlResult,
  type GraphicOutputFormat,
  createGraphicOutputUploadUrlSchema,
} from './create-graphic-output-upload-url.schema.js';

const UPLOAD_URL_TTL_SECONDS = 5 * 60;

const FORMAT_CONTENT_TYPE: Record<GraphicOutputFormat, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

export interface CreateGraphicOutputUploadUrlStorageDeps {
  getOrgAssetsBucket: typeof GetOrgAssetsBucketFn;
  getPresignedUploadUrl: typeof GetPresignedUploadUrlFn;
}

const createGraphicOutputUploadUrlImpl = async (
  db: DbConnection,
  storage: CreateGraphicOutputUploadUrlStorageDeps,
  input: CreateGraphicOutputUploadUrlInput
): Promise<Result<CreateGraphicOutputUploadUrlResult>> => {
  const parsed = createGraphicOutputUploadUrlSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, slideId, format, width, height } = parsed.data;

  const existing = await withOrgScope(
    (tx) =>
      tx.query.graphic.findFirst({
        where: and(
          eq(graphic.id, id),
          eq(graphic.organizationId, organizationId)
        ),
        columns: { id: true },
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
  // returned NOT_FOUND. The caller's `slideId` is now trusted; the upload URL is
  // already org-scoped via `objectKey`, and `confirmGraphicOutput` enforces the
  // `{organizationId}/graphics/{id}/` prefix on the returned key.
  const bucket = storage.getOrgAssetsBucket();
  const contentType = FORMAT_CONTENT_TYPE[format];
  const timestamp = Date.now();
  const random = randomUUID().split('-')[0];
  const objectKey = `${organizationId}/graphics/${id}/${slideId}-${timestamp}-${random}.${format}`;

  try {
    const uploadUrl = await storage.getPresignedUploadUrl({
      bucket,
      key: objectKey,
      contentType,
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    });

    return ok({
      uploadUrl,
      objectKey,
      bucket,
      contentType,
      expiresAt: new Date(
        timestamp + UPLOAD_URL_TTL_SECONDS * 1000
      ).toISOString(),
    });
  } catch (error) {
    logError('graphics.createGraphicOutputUploadUrl', error, {
      feature: 'graphics',
      extra: { id, slideId, format, width, height },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate upload URL'
      )
    );
  }
};

export const createGraphicOutputUploadUrl = (
  db: DbConnection,
  storage: CreateGraphicOutputUploadUrlStorageDeps,
  input: CreateGraphicOutputUploadUrlInput
) =>
  trackedResult(
    'graphics.createGraphicOutputUploadUrl',
    () => createGraphicOutputUploadUrlImpl(db, storage, input),
    {
      properties: {
        graphicId: input.id,
        slideId: input.slideId,
        format: input.format,
      },
    }
  );

export type CreateGraphicOutputUploadUrlResult_ = Awaited<
  ReturnType<typeof createGraphicOutputUploadUrl>
>;
