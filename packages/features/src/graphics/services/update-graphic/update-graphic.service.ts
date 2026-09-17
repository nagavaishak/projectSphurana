import {
  type AspectRatio,
  graphic,
  withOrgScope,
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
  type UpdateGraphicInput,
  updateGraphicSchema,
} from './update-graphic.schema.js';

const updateGraphicImpl = async (
  db: DbConnection,
  input: UpdateGraphicInput
): Promise<Result<typeof graphic.$inferSelect>> => {
  const parsed = updateGraphicSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, aspectRatio, ...updateData } = parsed.data;

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

    const [result] = await withOrgScope(
      (tx) =>
        tx
          .update(graphic)
          .set({
            ...updateData,
            ...(aspectRatio && { aspectRatio: aspectRatio as AspectRatio }),
          })
          .where(
            and(eq(graphic.id, id), eq(graphic.organizationId, organizationId))
          )
          .returning(),
      { db }
    );

    return ok(result);
  } catch (error) {
    logError('graphics.updateGraphic', error, {
      feature: 'graphics',
      extra: { id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to update graphic')
    );
  }
};

export const updateGraphic = (db: DbConnection, input: UpdateGraphicInput) =>
  trackedResult('graphics.updateGraphic', () => updateGraphicImpl(db, input), {
    properties: { id: input.id },
  });

export type UpdateGraphicResult = Awaited<ReturnType<typeof updateGraphic>>;
