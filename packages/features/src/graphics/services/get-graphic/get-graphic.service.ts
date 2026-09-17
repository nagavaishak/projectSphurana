import type { Graphic } from '@borradh-workspace/database';
import { graphic, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
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
  type GetGraphicInput,
  getGraphicSchema,
} from './get-graphic.schema.js';

/**
 * Backwards-compatible alias. Graphics no longer carry an image template
 * (the Fabric template pipeline was removed); the row is returned as-is.
 */
export type GraphicWithTemplate = Graphic;

const getGraphicImpl = async (
  db: DbConnection,
  input: GetGraphicInput
): Promise<Result<GraphicWithTemplate>> => {
  const parsed = getGraphicSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input'));
  }

  const result = await withOrgScope(
    (tx) =>
      tx.query.graphic.findFirst({
        where: and(
          eq(graphic.id, parsed.data.id),
          eq(graphic.organizationId, parsed.data.organizationId)
        ),
      }),
    { db }
  );

  if (!result) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Graphic not found'));
  }

  return ok(result);
};

export const getGraphic = (db: DbConnection, input: GetGraphicInput) =>
  trackedResult('graphics.getGraphic', () => getGraphicImpl(db, input), {
    properties: { id: input.id },
    internalErrorsOnly: true,
  });

export type GetGraphicResult = Awaited<ReturnType<typeof getGraphic>>;
