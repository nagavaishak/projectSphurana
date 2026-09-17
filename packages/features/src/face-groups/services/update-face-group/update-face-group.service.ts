import {
  type FaceGroup,
  faceGroup,
  withOrgScope,
} from '@borradh-workspace/database';
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
  type UpdateFaceGroupInput,
  updateFaceGroupSchema,
} from './update-face-group.schema.js';

const updateFaceGroupImpl = async (
  db: DbConnection,
  input: UpdateFaceGroupInput
): Promise<Result<FaceGroup>> => {
  const parsed = updateFaceGroupSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, clientName, clientNotes, serviceId } =
    parsed.data;

  return withOrgScope(
    async (tx) => {
      const existing = await tx.query.faceGroup.findFirst({
        where: (fg, { eq: e, and: a }) =>
          a(e(fg.id, id), e(fg.organizationId, organizationId)),
      });

      if (!existing) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Face group not found')
        );
      }

      const updates: Partial<typeof faceGroup.$inferInsert> = {};
      if (clientName !== undefined) updates.clientName = clientName;
      if (clientNotes !== undefined) updates.clientNotes = clientNotes;
      if (serviceId !== undefined) updates.serviceId = serviceId;

      if (Object.keys(updates).length === 0) {
        return ok(existing);
      }

      const [updated] = await tx
        .update(faceGroup)
        .set(updates)
        .where(
          and(
            eq(faceGroup.id, id),
            eq(faceGroup.organizationId, organizationId)
          )
        )
        .returning();

      return ok(updated);
    },
    { db }
  );
};

export const updateFaceGroup = (
  db: DbConnection,
  input: UpdateFaceGroupInput
) =>
  trackedResult(
    'faceGroups.updateFaceGroup',
    () => updateFaceGroupImpl(db, input),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type UpdateFaceGroupResult = Awaited<ReturnType<typeof updateFaceGroup>>;
