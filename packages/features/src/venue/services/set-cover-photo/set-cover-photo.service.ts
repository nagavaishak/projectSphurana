import {
  type OrganizationPhoto,
  organizationPhoto,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq, ne } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type SetCoverPhotoInput,
  setCoverPhotoSchema,
} from './set-cover-photo.schema.js';

/**
 * Mark one photo as the cover and clear the flag on the venue's OTHER photos in
 * the same write. At most one cover per location is enforced here (not by a
 * partial unique index) so reordering never has to fight a constraint mid-update.
 */
const setCoverPhotoImpl = async (
  db: DbConnection,
  input: SetCoverPhotoInput
): Promise<Result<{ items: OrganizationPhoto[] }>> => {
  const parsed = setCoverPhotoSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, locationId, photoId } = parsed.data;

  try {
    // Set the target as cover, scoped by org AND location so a foreign id (or a
    // photo of another venue) cannot win.
    const [updated] = await db
      .update(organizationPhoto)
      .set({ isCover: true })
      .where(
        and(
          eq(organizationPhoto.id, photoId),
          eq(organizationPhoto.organizationId, organizationId),
          eq(organizationPhoto.locationId, locationId)
        )
      )
      .returning({ id: organizationPhoto.id });

    if (!updated) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Photo not found'));
    }

    // Clear the flag on every OTHER photo of the SAME location.
    await db
      .update(organizationPhoto)
      .set({ isCover: false })
      .where(
        and(
          eq(organizationPhoto.organizationId, organizationId),
          eq(organizationPhoto.locationId, locationId),
          ne(organizationPhoto.id, photoId)
        )
      );

    const items = await db.query.organizationPhoto.findMany({
      where: and(
        eq(organizationPhoto.organizationId, organizationId),
        eq(organizationPhoto.locationId, locationId)
      ),
      orderBy: [asc(organizationPhoto.sortOrder)],
    });

    return ok({ items });
  } catch (error) {
    logError('venue.setCoverPhoto', error, {
      feature: 'venue',
      extra: { organizationId, photoId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to set cover photo')
    );
  }
};

export const setCoverPhoto = (db: DbConnection, input: SetCoverPhotoInput) =>
  trackedResult(
    'venue.setCoverPhoto',
    () => withOrgScope((tx) => setCoverPhotoImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        locationId: input.locationId,
        photoId: input.photoId,
      },
    }
  );

export type SetCoverPhotoResult = Awaited<ReturnType<typeof setCoverPhoto>>;
