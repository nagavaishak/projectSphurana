import {
  type OrganizationPhoto,
  organizationLocation,
  organizationPhoto,
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
  type CreateOrganizationPhotoInput,
  createOrganizationPhotoSchema,
} from './create-organization-photo.schema.js';

const createOrganizationPhotoImpl = async (
  db: DbConnection,
  input: CreateOrganizationPhotoInput
): Promise<Result<OrganizationPhoto>> => {
  const parsed = createOrganizationPhotoSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, locationId, url, caption, sortOrder, isCover } =
    parsed.data;

  try {
    // The photo's venue must belong to the caller's org — otherwise a guessed
    // locationId could attach a photo to another org's branch.
    const location = await db.query.organizationLocation.findFirst({
      where: and(
        eq(organizationLocation.id, locationId),
        eq(organizationLocation.organizationId, organizationId)
      ),
      columns: { id: true },
    });

    if (!location) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found'));
    }

    const [result] = await db
      .insert(organizationPhoto)
      .values({
        organizationId,
        locationId,
        url,
        caption: caption ?? null,
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        ...(isCover !== undefined ? { isCover } : {}),
      })
      .returning();

    return ok(result);
  } catch (error) {
    logError('venue.createOrganizationPhoto', error, {
      feature: 'venue',
      extra: { organizationId, locationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create photo')
    );
  }
};

export const createOrganizationPhoto = (
  db: DbConnection,
  input: CreateOrganizationPhotoInput
) =>
  trackedResult(
    'venue.createOrganizationPhoto',
    () => withOrgScope((tx) => createOrganizationPhotoImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        locationId: input.locationId,
      },
    }
  );

export type CreateOrganizationPhotoResult = Awaited<
  ReturnType<typeof createOrganizationPhoto>
>;
