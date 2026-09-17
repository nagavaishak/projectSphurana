import { organizationPhoto, withOrgScope } from '@borradh-workspace/database';
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
  type DeleteOrganizationPhotoInput,
  deleteOrganizationPhotoSchema,
} from './delete-organization-photo.schema.js';

/**
 * Hard delete: `organization_photo` has no soft-delete column. The delete is
 * scoped by BOTH id and organizationId so a caller can never remove another
 * org's photo even with a guessed id.
 */
const deleteOrganizationPhotoImpl = async (
  db: DbConnection,
  input: DeleteOrganizationPhotoInput
): Promise<Result<{ id: string }>> => {
  const parsed = deleteOrganizationPhotoSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  try {
    const [deleted] = await db
      .delete(organizationPhoto)
      .where(
        and(
          eq(organizationPhoto.id, id),
          eq(organizationPhoto.organizationId, organizationId)
        )
      )
      .returning({ id: organizationPhoto.id });

    if (!deleted) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Photo not found'));
    }

    return ok({ id: deleted.id });
  } catch (error) {
    logError('venue.deleteOrganizationPhoto', error, {
      feature: 'venue',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to delete photo')
    );
  }
};

export const deleteOrganizationPhoto = (
  db: DbConnection,
  input: DeleteOrganizationPhotoInput
) =>
  trackedResult(
    'venue.deleteOrganizationPhoto',
    () => withOrgScope((tx) => deleteOrganizationPhotoImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type DeleteOrganizationPhotoResult = Awaited<
  ReturnType<typeof deleteOrganizationPhoto>
>;
